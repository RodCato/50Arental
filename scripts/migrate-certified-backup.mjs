#!/usr/bin/env node
import {readFile,writeFile,mkdtemp,rm,rename,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SOURCE,PROJECT,NAMESPACE,hash,verifySource,mapSource,assertCertified,counts,financials,reconcile,destinationState,requireThat,uuid,schemaSignature} from './migration/model.mjs';
import {quote,snapshotSQL,schemaSQL,applySQL,rlsSQL} from './migration/sql.mjs';
const run=promisify(execFile),repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){const a=args[i];if(['--apply','--resume'].includes(a))options[a]=true;else if(['--source','--report','--cli'].includes(a)&&args[i+1])options[a]=args[++i];else throw Error('Usage: --source PATH --report OUTSIDE_REPO.json [--cli PATH] [--apply] [--resume]. Set MIGRATION_OWNER_EMAIL locally.');}
let report,stage='source verification';
const save=async()=>{const p=options['--report'];await writeFile(p+'.tmp',JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(p+'.tmp',p)};
async function cli(args){try{const {stdout}=await run(options['--cli']??'supabase',args,{cwd:repo,maxBuffer:8*1024*1024});return JSON.parse(stdout)}catch{throw Error(`Supabase operation failed at ${stage}; private server output suppressed`);}}
async function query(sql){const dir=await mkdtemp(join(tmpdir(),'50a-migration-'));try{const p=join(dir,'query.sql');await writeFile(p,sql,{mode:0o600});const result=await cli(['db','query','--linked','--project-ref',PROJECT,'--file',p,'--output','json']);return result.rows??result;}finally{await rm(dir,{recursive:true,force:true})}}
try{
 requireThat(options['--source']&&options['--report']&&process.env.MIGRATION_OWNER_EMAIL,'Source, report, and MIGRATION_OWNER_EMAIL required');
 const source=await realpath(options['--source']);requireThat((await stat(source)).isFile(),'Source must be ordinary file');
 const reportPath=resolve(await realpath(dirname(resolve(options['--report']))),resolve(options['--report']).split('/').at(-1));
 requireThat(!reportPath.startsWith(repo+'/')&&reportPath!==source,'Report must be outside repository and distinct from source');options['--report']=reportPath;
 const bytes=await readFile(source),{backup,summary}=await verifySource(bytes);
 // Invoke the standalone validator as well as the independently reusable validator.
 await run(process.execPath,[join(repo,'scripts/validate-backup.mjs'),source],{maxBuffer:1024*1024});
 stage='project verification';const projects=await cli(['projects','list','--output','json']);requireThat(projects.some(p=>(p.id??p.ref)===PROJECT&&p.name==='50a-ledger'),'Project identity mismatch');
 stage='owner verification';const owners=await query(`select id from auth.users where lower(email)=lower(${quote(process.env.MIGRATION_OWNER_EMAIL)}) and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<now())`);
 requireThat(owners.length===1,'Expected one confirmed active Auth owner');const owner=owners[0].id;
 const {rows,mapping}=mapSource(backup,owner,SOURCE.sha256);assertCertified(rows,summary);
 stage='schema verification';const [{schema}]=await query(schemaSQL);const expectedSchema=JSON.parse(await readFile(join(repo,'scripts/migration/schema.json'),'utf8'));
 requireThat(schemaSignature(schema)===schemaSignature(expectedSchema),'Hosted schema differs from tested Phase 1 schema; stop for review');
 let previous;try{previous=JSON.parse(await readFile(reportPath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw Error('Existing manifest unreadable')}
 if(options['--resume'])requireThat(previous?.sourceSha256===SOURCE.sha256&&previous?.owner===owner&&previous?.project===PROJECT&&previous?.namespace===NAMESPACE&&['applying','applied','reconciled','failed'].includes(previous?.status),'Resume requires matching durable apply manifest');
 else requireThat(!previous||previous.status==='dry-run','Existing apply manifest requires --resume');
 stage='destination preflight';const [snapshot]=await query(snapshotSQL);requireThat(snapshot.objects===0&&snapshot.private_buckets===1,'Storage must be private and empty');const state=destinationState(snapshot.rows,rows,!!options['--resume']);
 report={toolVersion:1,schemaVersion:1,sourceSha256:SOURCE.sha256,sourceStateSha256:SOURCE.state,sourceManifestSha256:SOURCE.manifest,sourceBytes:bytes.length,format:backup.format,version:backup.version,project:PROJECT,owner,ownerStrategy:'CLI administrator resolves one confirmed active Auth user from explicitly supplied email; writes execute with authenticated role and owner claim',namespace:NAMESPACE,startedAt:previous?.startedAt??new Date().toISOString(),status:'dry-run',sourceCounts:{transactions:summary.transactions,lineItems:summary.lineItems,recurringBills:summary.recurringBills,activeBills:summary.activeBills,inactiveBills:summary.inactiveBills,waterEvents:summary.waterEvents,propertyRecords:summary.propertyRecords,attachmentReferences:summary.attachmentReferences,embeddedAttachments:summary.embeddedAttachments,inlineEvidence:summary.inlineEvidence},plannedCounts:counts(rows),idMapping:mapping,financials:financials(rows),sourceValidation:'PASS',schemaValidation:'PASS',destinationPreflight:state,storageObjects:0,storagePrivate:true};
 // A resume dry-run must not erase evidence that an apply has already begun.
 if(options['--resume']){
  report.status=previous.status;
  for(const key of ['completedAt','reconciliation','rls'])if(previous[key]!==undefined)report[key]=previous[key];
 }
 await save();console.log(JSON.stringify({source:'PASS',project:'50a-ledger',destination:state,counts:report.plannedCounts,financials:report.financials,dryRun:'PASS'},null,2));
 if(options['--apply']){
  stage='apply';report.status='applying';await save();
  requireThat(hash(await readFile(source))===SOURCE.sha256,'Source changed before apply');
  if(state==='empty')await query(applySQL(rows,owner));
  report.status='applied';await save();
  stage='independent read-back';const [after]=await query(snapshotSQL);requireThat(after.objects===0&&after.private_buckets===1,'Storage changed');report.reconciliation=reconcile(rows,after.rows,owner);
  stage='populated RLS verification';const other=uuid(SOURCE.sha256,'policy-test','non-owner');requireThat(other!==owner,'Policy identity collision');
  const result=await query(rlsSQL(owner,other,rows));requireThat(result.at(-1)?.rls_pass===true,'RLS verification failed');report.rls='PASS';
  // Confirm policy probes did not change business rows.
  const [final]=await query(snapshotSQL);reconcile(rows,final.rows,owner);requireThat(final.objects===0&&final.private_buckets===1,'Storage changed after RLS');
  requireThat(hash(await readFile(source))===SOURCE.sha256,'Source changed during migration');
  report.status='reconciled';report.completedAt=new Date().toISOString();await save();console.log(JSON.stringify({apply:'PASS',reconciliation:report.reconciliation,rls:report.rls,storageObjects:0},null,2));
 }
}catch(e){if(report){report.status='failed';report.failedStage=stage;await save()}console.error(`STOP at ${stage}: ${e.message.startsWith('$')?'Backup validation failed (details suppressed)':e.message}`);process.exitCode=1;}

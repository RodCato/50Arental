import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {CURRENT_CONTRACT,missing} from '../cloud/contract.mjs';
export const migrationDiff=(files,hosted)=>files.filter(f=>/^\d+_.+\.sql$/.test(f)&&!hosted.includes(f.split('_')[0]));
export function checkSnapshot(snapshot,files,onlyMigrations=false){const pending=migrationDiff(files,snapshot.migrations||[]),absent=onlyMigrations?[]:missing(snapshot.capabilities);return {ok:!pending.length&&!absent.length,requiredContract:CURRENT_CONTRACT.contract_version,hostedContract:snapshot.capabilities?.contract_version??null,pendingMigrations:pending,missingCapabilities:absent};}
if(process.argv[1]?.endsWith('/check-cloud-contract.mjs')){
 try{const mode=process.argv.includes('--migrations'),files=readdirSync('supabase/migrations');let snapshot;
 if(process.env.CLOUD_CHECK_FIXTURE)snapshot=JSON.parse(readFileSync(process.env.CLOUD_CHECK_FIXTURE,'utf8'));
 else{
 const query="begin read only; select jsonb_build_object('migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),'capability_exists',to_regprocedure('public.ledger_capabilities()') is not null) as audit; rollback;";
 const run=q=>JSON.parse(execFileSync(process.env.SUPABASE_BIN||'supabase',['db','query','--linked',q,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).rows[0];snapshot=run(query).audit;
 if(!mode&&snapshot.capability_exists){const r=run("begin read only; do $$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);end $$;set local role authenticated;select public.ledger_capabilities() as capabilities;rollback;");snapshot.capabilities=r.capabilities;}}
 const result=checkSnapshot(snapshot,files,mode);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
 }catch{console.error('Read-only cloud preflight could not verify the linked project. Check CLI authentication/link; no migrations were applied.');process.exitCode=1;}
}

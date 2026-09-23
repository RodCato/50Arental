// Creates its own socket-only PostgreSQL cluster; never accepts a database URL.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import Backup from '../backup-utils.js';
import {fixture} from '../tests/backup-fixture.cjs';
import {hash,mapSource,reconcile,destinationState} from './migration/model.mjs';
import {schemaSQL,applySQL,snapshotSQL,rlsSQL} from './migration/sql.mjs';
const dir=await mkdtemp(join(tmpdir(),'50a-import-test-')),root=resolve(import.meta.dirname,'..');
const env={...process.env,PGHOST:dir,PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'postgres'};
const cmd=(name,args)=>execFileSync(name,args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const sql=s=>execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']});
try{
 cmd('initdb',['-D',join(dir,'data'),'-A','trust','-U','postgres']);cmd('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'log'),'-o',`-k ${dir} -p 55441 -c listen_addresses=''`,'-w','start']);
 sql(await readFile(join(root,'supabase/tests/mock-platform.sql'),'utf8'));sql(await readFile(join(root,'supabase/migrations/20260922000100_initial_50a_schema.sql'),'utf8'));
 const schema=JSON.parse(sql(schemaSQL));
 if(process.argv.includes('--record-schema'))await writeFile(join(root,'scripts/migration/schema.json'),JSON.stringify(schema,null,2)+'\n');
 else assert.deepEqual(schema,JSON.parse(await readFile(join(root,'scripts/migration/schema.json'),'utf8')));
 const owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
 sql(`alter table auth.users add column email_confirmed_at timestamptz, add column deleted_at timestamptz, add column banned_until timestamptz; insert into auth.users(id,email_confirmed_at) values('${owner}',now());`);
 const f=fixture();f.state.condition=[];for(const t of f.state.transactions){t.attachmentIds=[];t.receipt=null;}const b=await Backup.create(f.state,()=>null);const {rows}=mapSource(b,owner,hash(JSON.stringify(b)));
 const snapshot=()=>JSON.parse(sql(`select row_to_json(s) from (${snapshotSQL}) s`));
 assert.equal(destinationState(snapshot().rows,rows,false),'empty');
 const bad=structuredClone(rows);bad.transaction_items[0].amount=-1;assert.throws(()=>sql(applySQL(bad,owner)));assert.equal(destinationState(snapshot().rows,rows,false),'empty','Failed transaction must roll back all parents');
 sql(applySQL(rows,owner));reconcile(rows,snapshot().rows,owner);assert.equal(snapshot().objects,0);
 assert.equal(destinationState(snapshot().rows,rows,true),'already-applied');assert.throws(()=>sql(applySQL(rows,owner)),'Race/repeated direct apply must refuse inserts');reconcile(rows,snapshot().rows,owner);
 sql(rlsSQL(owner,other,rows));reconcile(rows,snapshot().rows,owner);
 console.log('PASS: tested Phase 1 schema; atomic rollback, deterministic retry/no duplicates, read-back financial/structural reconciliation, populated RLS and empty Storage.');
}finally{try{cmd('pg_ctl',['-D',join(dir,'data'),'-m','immediate','stop'])}catch{}await rm(dir,{recursive:true,force:true})}

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
const dir=await mkdtemp(join(tmpdir(),'50a-cutover-test-')),root=resolve(import.meta.dirname,'..');
const env={...process.env,PGHOST:dir,PGPORT:'55442',PGUSER:'postgres',PGDATABASE:'postgres'};
const cmd=(name,args)=>execFileSync(name,args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const sql=s=>execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']});
try{
 cmd('initdb',['-D',join(dir,'data'),'-A','trust','-U','postgres']);cmd('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'log'),'-o',`-k ${dir} -p 55442 -c listen_addresses=''`,'-w','start']);
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
 sql(await readFile(join(root,'supabase/migrations/20260923000200_cloud_ledger_rpc.sql'),'utf8'));
 sql(await readFile(join(root,'supabase/migrations/20260923000300_cloud_evidence.sql'),'utf8'));
 sql(await readFile(join(root,'supabase/migrations/20260924000100_property_multi_photo.sql'),'utf8'));
 const rpc=(body)=>sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${owner}',true); ${body}; commit;`);
 const read=()=>JSON.parse(rpc('select public.ledger_read()').trim().split('\n').at(-1));
 let snap=read(); assert.equal(snap.rows.transactions.length,rows.transactions.length);
 const bill={...rows.recurring_charges[1],amount:75};
 const tx={...rows.transactions[0],one_time_amount:0};
 const item={...rows.transaction_items[0],amount:75};
 const changes={recurring_charges:{put:[bill],remove:[]},transactions:{put:[tx],remove:[]},transaction_items:{put:[item],remove:[]}};
 const {quote}=await import('./migration/sql.mjs');
 const op='cccccccc-cccc-4ccc-accc-cccccccccccc';
 const apply=(revision,delta,id=op)=>rpc(`select public.ledger_apply('${id}',${quote(revision)},${quote(JSON.stringify(delta))}::jsonb)`);
 apply(snap.revision,changes);let next=read();assert.notEqual(next.revision,snap.revision);assert.equal(next.rows.recurring_charges.find(r=>r.id===bill.id).amount,75);
 apply(snap.revision,changes);assert.equal(read().revision,next.revision,'Idempotency retry');
 assert.throws(()=>apply(snap.revision,changes,'dddddddd-dddd-4ddd-addd-dddddddddddd'),'Stale revision');
 const invalid=structuredClone(changes);invalid.transaction_items.put[0].amount=-1;
 assert.throws(()=>apply(next.revision,invalid,'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'));assert.equal(read().revision,next.revision,'Atomic invalid-item rollback');
 const fixed=structuredClone(changes);fixed.recurring_charges.put=[{...rows.recurring_charges[0],amount:75}];
 assert.throws(()=>apply(next.revision,fixed,'ffffffff-ffff-4fff-afff-ffffffffffff'));assert.equal(read().revision,next.revision,'Fixed protection');

 // A synthetic non-owner cannot read or apply changes carrying the owner's identity.
 const nonowner=sql(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${other}',true);select public.ledger_read();rollback;`).trim().split('\n').at(-1);
 assert.equal(JSON.parse(nonowner).rows.transactions.length,0);
 assert.throws(()=>sql(`begin;set local role anon;select public.ledger_read();rollback;`));
 assert.throws(()=>sql(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${other}',true);select public.ledger_apply('11111111-1111-4111-a111-111111111111',public.ledger_read()->>'revision',${quote(JSON.stringify(changes))}::jsonb);rollback;`));
 assert.equal(read().revision,next.revision,'RLS probes preserve owner rows');
 // Independent CRUD domains each retain optimistic revision protection.
 const doChange=delta=>{const id=crypto.randomUUID();apply(read().revision,delta,id);return read()};
 const water={id:crypto.randomUUID(),owner_id:owner,completed_at:'2026-09-23T00:00:00Z',gallons:1,legacy:false};
 let saved=doChange({water_events:{put:[water],remove:[]}});assert.equal(saved.rows.water_events.length,rows.water_events.length+1);
 saved=doChange({water_events:{put:[],remove:[water.id]}});assert.equal(saved.rows.water_events.length,rows.water_events.length);
 saved=doChange({user_settings:{put:[{...rows.user_settings[0],setup_budget:450}],remove:[]}});assert.equal(saved.rows.user_settings[0].setup_budget,450);
 saved=doChange({benchmark_adjustments:{put:[{...rows.benchmark_adjustments[0],amount:12}],remove:[]}});assert.equal(saved.rows.benchmark_adjustments.find(r=>r.id===rows.benchmark_adjustments[0].id).amount,12);
 const newBill={...rows.recurring_charges[0],id:crypto.randomUUID(),name:'Synthetic temporary',active:true};
 saved=doChange({recurring_charges:{put:[newBill],remove:[]}});assert.ok(saved.rows.recurring_charges.some(r=>r.id===newBill.id));
 saved=doChange({recurring_charges:{put:[{...newBill,active:false}],remove:[]}});assert.equal(saved.rows.recurring_charges.find(r=>r.id===newBill.id).active,false);
 const newTx={...rows.transactions[0],id:crypto.randomUUID(),system_key:null,sample_key:null,recurring_charge_id:null,one_time_amount:0};
 const newItem={...rows.transaction_items[0],id:crypto.randomUUID(),transaction_id:newTx.id,amount:1.23};
 saved=doChange({transactions:{put:[newTx],remove:[]},transaction_items:{put:[newItem],remove:[]}});assert.ok(saved.rows.transactions.some(r=>r.id===newTx.id));
 saved=doChange({transaction_items:{put:[{...newItem,amount:2.34}],remove:[]}});assert.equal(saved.rows.transaction_items.find(r=>r.id===newItem.id).amount,2.34);
 console.log('PASS: cloud RPC atomicity, transaction/bill/settings/benchmark/water CRUD, estimate updates, fixed protection, conflicts, idempotent replay and owner/non-owner/anonymous RLS.');

}finally{try{cmd('pg_ctl',['-D',join(dir,'data'),'-m','immediate','stop'])}catch{}await rm(dir,{recursive:true,force:true})}

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const U=require('../backup-utils.js'),S=require('../backup-storage.js'),{fixture,png,stamp}=require('./backup-fixture.cjs');
async function backup(){const f=fixture();return U.create(f.state,f.get)}
function adapter(state){
  let raw=JSON.stringify(state),writes=0;const db={recovery:new Map(),attachments:new Map()},hooks={};
  const io={read:()=>raw,activate:value=>{if(hooks.quota)throw Error('quota');raw=value;if(hooks.afterActivate)hooks.afterActivate()},get:async(store,id)=>db[store].get(id),uuid:()=> 'synthetic-generation',write:async ops=>{writes++;if(writes===hooks.failWrite)throw Error('IDB');for(const o of ops)db[o.store].set(o.value.id,structuredClone(o.value));if(writes===hooks.interruptAfterWrite)throw Error('interrupted')},attachment:async(id,g)=>{const r=db.attachments.get(S.key(g,id));return r?{...r,id}:null}};
  return {io,db,hooks,setRaw:v=>raw=v,coordinator:S.coordinator(io)};
}
test('representative v3 export -> validator -> staged restore -> startup -> re-export preserves business data and bytes',async()=>{
 const f=fixture(),b=await U.create(f.state,f.get),a=adapter(f.state);await a.coordinator.stage(b,f.state,f.get);
 assert.equal((await a.coordinator.recover()).pending,true);await a.coordinator.completeStartup();assert.equal(a.db.recovery.get('journal').phase,'verified');
 const restored=JSON.parse(a.io.read());assert.equal(restored.syncMeta,undefined);assert.equal(restored.settings.googleSync.accountEmail,null);
 const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');const line=name=>source.split('\n').find(l=>l.startsWith(`function ${name}(`));const context={localStorage:{getItem:()=>a.io.read()},JSON};vm.createContext(context);vm.runInContext(source.split('\n').slice(0,7).join('\n')+'\n'+line('normalizeSettings')+'\n'+line('load')+'\nvar reopened=load();',context);
 const next=await U.create(context.reopened,id=>a.io.attachment(id,restored.attachmentGeneration));assert.deepEqual(next.state,b.state);assert.deepEqual(next.manifest,b.manifest);assert.deepEqual(next.provenance,b.provenance);
 const result=await U.validate(next);assert.equal(result.restoreEquivalent,true);assert.equal(result.summary.actualExpenses,253);assert.equal(result.summary.months['2026-09'].utilities,123);assert.equal(result.summary.recurringRunRate,1119);assert.equal(result.summary.monthlySavings,652.38);assert.equal(result.summary.annual,7828.56);
 assert.deepEqual((await a.coordinator.previousBackup()).state,b.state);assert.equal(next.state.transactions[1].items[1].setupClass,'move_in_essential');
 for(const bytes of result.decoded.values())assert.equal(U.dataURL(bytes,'image/png'),'data:image/png;base64,'+png);
});
test('export snapshot is frozen before asynchronous evidence reads; incomplete evidence fails',async()=>{const f=fixture();let first=true;const b=await U.create(f.state,async id=>{if(first){first=false;f.state.budget=999;f.state.transactions[0].attachmentIds=[]}return f.get(id)});assert.equal(b.state.budget,400);assert.equal(b.attachments.length,2);await assert.rejects(()=>U.create(fixture().state,()=>null),/2 referenced attachments/)});
test('legacy receipt data URLs are hashed and portable; remote/blob/relative evidence rejected without fetching',async()=>{for(const r of ['blob:secret','https://example.test/image','./photo.png','invalid']){const f=fixture();f.state.transactions[0].receipt=r;await assert.rejects(()=>U.create(f.state,f.get),/nonportable evidence/)}const f=fixture();f.state.transactions[0].receipt='data:image/png;base64,'+png;const b=await U.create(f.state,f.get);assert.equal(b.manifest.inlineEvidence.length,1);assert.equal((await U.validate(b)).summary.inlineEvidence,1)});
const cases=[
 ['duplicate transaction ID',b=>b.state.transactions.push(b.state.transactions[0]),/duplicate ID/],
 ['duplicate recurring ID',b=>b.state.recurringCharges.push(b.state.recurringCharges[0]),/duplicate ID/],
 ['duplicate condition ID',b=>b.state.condition.push(b.state.condition[0]),/duplicate ID/],
 ['dangling recurringChargeId',b=>b.state.transactions[0].recurringChargeId='missing',/dangling reference/],
 ['dangling attachment',b=>b.state.transactions[0].attachmentIds.push('missing'),/hash mismatch|completeness/],
 ['unsupported version',b=>b.version=999,/unsupported version/],
 ['wrong format',b=>b.format='other',/unsupported format/],
 ['malformed settings',b=>b.state.settings=[],/expected object/],
 ['malformed recurring collection',b=>b.state.recurringCharges={},/expected bounded array/],
 ['malformed condition',b=>b.state.condition=null,/expected bounded array/],
 ['malformed Waterdrop',b=>b.state.settings.waterdropPayback.waterdropCompletions={},/expected bounded array/],
 ['invalid oneTimeAmount',b=>b.state.transactions[0].oneTimeAmount=124,/exceeds payment/],
 ['invalid calendar date',b=>b.state.transactions[0].date='2026-02-30',/calendar date/],
 ['nonfinite amount',b=>b.state.transactions[0].items[0].amount='Infinity',/invalid number/],
 ['unknown status',b=>b.state.transactions[0].items[0].status='other',/unsupported value/],
 ['conflicting parents',b=>b.state.condition[0].attachmentId='receipt',/conflicting parents/],
 ['corrupt base64',b=>b.attachments[0].data='data:image/png;base64,%%%=',/base64/],
 ['MIME magic mismatch',b=>b.attachments[0].data='data:image/jpeg;base64,'+png,/MIME\/magic/],
 ['attachment hash mismatch',b=>b.attachments[0].data=b.attachments[0].data.replace('RZkA','RZkB'),/hash mismatch/],
 ['duplicate attachment',b=>b.attachments.push(b.attachments[0]),/duplicate ID/],
 ['structured hash',b=>b.state.budget=500,/hash mismatch/],
 ['manifest hash',b=>b.exportedAt='2026-09-02T00:00:00.000Z',/hash mismatch/],
 ['credential property',b=>b.state.access_token='synthetic',/prohibited property/],
];
for(const [name,mutate,pattern] of cases)test('rejects '+name+' before writes',async()=>{const b=await backup();mutate(b);const f=fixture(),a=adapter(f.state),before=a.io.read();await assert.rejects(()=>a.coordinator.stage(b,f.state,f.get),pattern);assert.equal(a.io.read(),before);assert.equal(a.db.recovery.size,0);assert.equal(a.db.attachments.size,0)});
test('v2 conversion explicitly preserves current values, is deterministic/idempotent, rejects missing evidence',async()=>{const f=fixture(),b=await U.create(f.state,f.get),v2={format:U.FORMAT,version:2,state:f.state,attachments:b.attachments.map(a=>({...a,transactionId:a.parentType==='condition'?'condition:'+a.parentId:a.parentId}))};const converted=await U.convertV2(v2,f.state.settings);assert.deepEqual(converted.state,b.state);assert.equal(converted.provenance.sourceVersion,2);const second=await U.create(U.runtimeState(converted,'test'),f.get);assert.deepEqual(second.state,converted.state);assert.deepEqual(second.provenance,converted.provenance);v2.attachments=[];await assert.rejects(()=>U.convertV2(v2,f.state.settings),/missing/)});
test('historical Josh values and sample dates/classification stay unchanged in v3 on reload',async()=>{const f=fixture();f.state.settings.joshStayDays=69;f.state.settings.joshAdjustments[1].amount=514;f.state.transactions[0].sampleKey='sample_50a_monthly_housing';const b=await U.create(f.state,f.get);assert.equal(b.state.settings.joshStayDays,69);assert.equal(b.state.settings.joshAdjustments[1].amount,514);assert.equal(b.state.transactions[0].date,'2026-09-01');assert.equal(U.runtimeState(b,'x').transactions.length,2)});
test('recovery snapshot failure blocks replacement',async()=>{const f=fixture(),a=adapter(f.state),before=a.io.read();await assert.rejects(async()=>a.coordinator.stage(await backup(),f.state,()=>null),/Recovery snapshot failed/);assert.equal(a.io.read(),before);assert.equal(a.db.recovery.size,0)});
for(const failWrite of [1,2,3])test(`storage write failure ${failWrite} retains previous generation`,async()=>{const f=fixture(),a=adapter(f.state),before=a.io.read();a.hooks.failWrite=failWrite;await assert.rejects(async()=>a.coordinator.stage(await backup(),f.state,f.get),/failed/);assert.equal(a.io.read(),before);await a.coordinator.recover();assert.equal(a.io.read(),before)});
test('quota failure blocks activation; journal can recover next startup',async()=>{const f=fixture(),a=adapter(f.state),before=a.io.read();a.hooks.quota=true;await assert.rejects(async()=>a.coordinator.stage(await backup(),f.state,f.get),/Activation failed/);assert.equal(a.io.read(),before);a.hooks.quota=false;await a.coordinator.recover();assert.equal(a.io.read(),before)});
for(const n of [1,2])test(`interruption after staging boundary ${n} rolls back on startup`,async()=>{const f=fixture(),a=adapter(f.state),before=a.io.read();a.hooks.interruptAfterWrite=n;await assert.rejects(async()=>a.coordinator.stage(await backup(),f.state,f.get));await a.coordinator.recover();assert.equal(a.io.read(),before);assert.equal(a.db.recovery.get('journal').phase,'rolled-back')});
test('interruption after localStorage activation but before commit marker completes safely after reopening',async()=>{const f=fixture(),a=adapter(f.state);await a.coordinator.stage(await backup(),f.state,f.get);a.db.recovery.get('journal').phase='staged';assert.equal((await a.coordinator.recover()).pending,true);await a.coordinator.completeStartup();assert.equal(a.db.recovery.get('journal').phase,'verified')});
test('render failure after activation rolls back; next startup keeps previous state',async()=>{const f=fixture(),a=adapter(f.state),before=a.io.read();await a.coordinator.stage(await backup(),f.state,f.get);await a.coordinator.recover();await a.coordinator.startupFailed();assert.equal(a.io.read(),before);assert.equal((await a.coordinator.recover()).pending,false);assert.ok(await a.coordinator.previousBackup())});
test('corrupt staged image triggers rollback on next startup',async()=>{const f=fixture(),a=adapter(f.state),before=a.io.read();await a.coordinator.stage(await backup(),f.state,f.get);a.db.attachments.delete(S.key('synthetic-generation','receipt'));assert.equal((await a.coordinator.recover()).rolledBack,true);assert.equal(a.io.read(),before)});
test('concurrent-tab change is never overwritten during recovery',async()=>{const f=fixture(),a=adapter(f.state);await a.coordinator.stage(await backup(),f.state,f.get);const other=JSON.stringify({...f.state,budget:777});a.setRaw(other);await assert.rejects(()=>a.coordinator.recover(),/conflict/);assert.equal(a.io.read(),other)});
test('standalone CLI is read-only, sanitized, and hashes the original file',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'50a-backup-'));try{const file=path.join(dir,'fixture.json'),bytes=JSON.stringify(await backup());fs.writeFileSync(file,bytes);const output=execFileSync(process.execPath,['scripts/validate-backup.mjs',file],{encoding:'utf8'});assert.match(output,/BACKUP INTEGRITY: PASS/);assert.ok(output.includes(await U.sha256(bytes)));assert.doesNotMatch(output,/PRIVATE_|private@example|receipt\.png|iVBOR/);assert.equal(fs.readFileSync(file,'utf8'),bytes)}finally{fs.rmSync(dir,{recursive:true})}});
test('background saves are blocked while restore owns the ledger',()=>{const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),save=source.split('\n').find(l=>l.startsWith('function save('));let writes=0;const context={backupInProgress:true,markSyncDirty:()=>{writes++},localStorage:{setItem:()=>{writes++}},render:()=>{writes++}};vm.createContext(context);vm.runInContext(save,context);assert.throws(()=>vm.runInContext('save()',context),/Restore in progress/);assert.equal(writes,0)});
test('editing settings preserves restored Waterdrop history',()=>{const f=fixture(),source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),wrapper=source.split('\n').find(l=>l.startsWith('const syncPaybackSettings='));const before=U.clone(f.state.settings.waterdropPayback.waterdropCompletions);const context={state:f.state,syncSettingsFromInputs:()=>{f.state.settings.waterdropPayback={gallonsLogged:2,baselineCostPerGallon:1.5,systemCost:73.35,breakEvenGallon:59}}};vm.createContext(context);vm.runInContext(wrapper+';syncSettingsFromInputs()',context);assert.deepEqual(f.state.settings.waterdropPayback.waterdropCompletions,before);assert.equal(f.state.settings.waterdropPayback.baselineCostPerGallon,1.5)});
test('portable artifact omits device/account synchronization identity',async()=>{const b=await backup(),serialized=JSON.stringify(b);assert.doesNotMatch(serialized,/PRIVATE_CLIENT_ID|PRIVATE_DEVICE|private@example\.test|"googleSync"|"syncMeta"/);assert.equal(b.provenance.recordTimestamps.length,1);assert.equal(b.provenance.tombstones.length,1)});
test('real-representation regression: blank adjustment survives load/export/restore/reload/re-export with identical finances',async()=>{
 const f=require('./backup-fixture.cjs').historicalNumericFixture(),Finance=require('../finance-utils.js');
 assert.equal(f.state.transactions[5].items[0].adjustment,'');assert.equal(typeof f.state.transactions[5].items[0].adjustment,'string');
 const before=U.clone(f.state),totals=Finance.expenses(f.state.transactions.flatMap(t=>t.items)),b=await U.create(f.state,f.get),a=adapter(f.state);
 await U.validate(b);assert.deepEqual(f.state,before);await a.coordinator.stage(b,f.state,f.get);await a.coordinator.recover();await a.coordinator.completeStartup();
 const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),line=name=>source.split('\n').find(l=>l.startsWith(`function ${name}(`));const context={localStorage:{getItem:()=>a.io.read()},JSON};vm.createContext(context);vm.runInContext(source.split('\n').slice(0,7).join('\n')+'\n'+line('normalizeSettings')+'\n'+line('load')+'\nvar reopened=load();',context);
 const next=await U.create(context.reopened,id=>a.io.attachment(id,context.reopened.attachmentGeneration));await U.validate(next);assert.deepEqual(next.state,b.state);assert.equal(next.state.transactions[5].items[0].adjustment,'');assert.deepEqual(Finance.expenses(next.state.transactions.flatMap(t=>t.items)),totals);
});
test('optional legacy zeros preserve exact representations and associated-payment/deposit semantics',async()=>{
 for(const value of ['',null,undefined,'0',0]){
  const f=fixture(),t=f.state.transactions[0];for(const k of ['adjustment','depositRefunded']){if(value===undefined)delete t.items[0][k];else t.items[0][k]=value}if(value===undefined)delete t.oneTimeAmount;else t.oneTimeAmount=value;
  f.state.transactions[1].items[2].depositRefunded=value;
  const b=await U.create(f.state,f.get);await U.validate(b);assert.deepEqual(b.state.transactions,U.portableState(f.state).transactions);assert.equal((await U.validate(b)).summary.months['2026-09'].utilities,123);assert.equal((await U.validate(b)).summary.actualExpenses,278);
 }
});
test('strict decimal representations apply consistently to every money/count field',async()=>{
 const f=fixture();f.state.budget='400.00';for(const k of ['rent50a','forgottenEssentialsBudget','joshRent','joshStayDays','proratedRent','adminFee','depositAmount','depositRefunded'])f.state.settings[k]=String(f.state.settings[k]);for(const a of f.state.settings.joshAdjustments)a.amount=String(a.amount);for(const k of ['gallonsLogged','baselineCostPerGallon','systemCost','breakEvenGallon'])f.state.settings.waterdropPayback[k]=String(f.state.settings.waterdropPayback[k]);for(const b of f.state.recurringCharges)b.amount=String(b.amount);f.state.transactions[0].oneTimeAmount='3e1';f.state.transactions[1].items[1].giftCardOffset='5.00';
 const b=await U.create(f.state,f.get);assert.equal((await U.validate(b)).summary.actualExpenses,253);assert.equal(b.state.transactions[0].oneTimeAmount,'3e1');assert.equal((await U.validate(b)).summary.monthlySavings,652.38);
});
test('malformed coercions and nonfinite numbers are never turned into optional zero',async()=>{
 for(const value of [NaN,Infinity,-Infinity,'NaN','Infinity','refund','0x10','0b10','1_000','1,00','1.2.3',' ',' 0','0 ','1e999',false,true,[],{},-1,'-1']){
  for(const field of ['adjustment','depositRefunded','oneTimeAmount']){const f=fixture();if(field==='oneTimeAmount')f.state.transactions[0][field]=value;else f.state.transactions[0].items[0][field]=value;await assert.rejects(()=>U.create(f.state,f.get),/invalid number|nonfinite number/)}
 }
});
test('empty optional policy does not spread to required money/counts or optional metadata',async()=>{
 for(const value of ['',null,undefined]){
  const edits=[f=>f.state.transactions[0].items[0].amount=value,f=>f.state.recurringCharges[0].amount=value,f=>f.state.budget=value,f=>f.state.settings.joshRent=value,f=>f.state.settings.joshStayDays=value,f=>f.state.settings.waterdropPayback.systemCost=value,f=>f.state.settings.joshAdjustments[0].amount=value];
  if(value!==undefined)edits.push(f=>f.state.transactions[0].items[0].giftCardOffset=value);
  for(const edit of edits){const f=fixture();edit(f);await assert.rejects(()=>U.create(f.state,f.get),/invalid number/)}
 }
 for(const [field,value] of [['oneTimeAmount',124],['depositRefunded',124]]){const f=fixture();if(field==='oneTimeAmount')f.state.transactions[0][field]=value;else f.state.transactions[0].items[0][field]=value;await assert.rejects(()=>U.create(f.state,f.get),/exceeds/)}
});

test('property v3 expands to ordered arrays without rewriting legacy single-photo snapshots',async()=>{
 const {fixture}=require('./backup-fixture.cjs'),f=fixture();const old=await U.create(f.state,f.get);await U.validate(old);assert.equal(old.state.condition[0].attachmentId,'property');
 const state=structuredClone(f.state);delete state.condition[0].attachmentId;state.condition[0].attachmentIds=['property','property-2','property-3'];const get=id=>id.startsWith('property-')?{...f.get('property'),id}:f.get(id);
 const b=await U.create(state,get),v=await U.validate(b);assert.equal(v.decoded.size,4);assert.deepEqual(U.runtimeState(b,'test').condition,state.condition);assert.equal(b.version,3);
 await assert.rejects(()=>U.create(state,id=>id==='property-2'?null:get(id)),/missing/);
 const duplicate=structuredClone(state);duplicate.condition[0].attachmentIds.push('property');await assert.rejects(()=>U.create(duplicate,get),/duplicate attachment/);
 const conflict=structuredClone(state);conflict.condition.push({...conflict.condition[0],id:'other'});await assert.rejects(()=>U.create(conflict,get),/conflicting parents/);
 const ambiguous=structuredClone(state);ambiguous.condition[0].attachmentId='property';await assert.rejects(()=>U.create(ambiguous,get),/ambiguous/);
});

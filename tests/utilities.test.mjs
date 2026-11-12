import test from 'node:test';import assert from 'node:assert/strict';
import U from '../utilities-utils.js';import F from '../finance-utils.js';import R from '../recurring-utils.js';import B from '../backup-utils.js';import H from '../housing-utils.js';
import {baselineFixture} from './cloud-fixture.mjs';import {fromCloud,toCloud,diff} from '../cloud/ledger-model.mjs';
import {utilityFixture,utilityItem as item,utilityPayment as payment} from './utilities-fixture.mjs';
const options={month:'2026-11',today:'2026-11-11'};
const report=s=>U.history(s,options);
test('actual posting-month dollars include full one-time payment once; estimates, internet, Kids/Ex and unrelated purchases excluded',()=>{
 const s=utilityFixture(),before=JSON.stringify(s),grand=F.expenses(s.transactions.flatMap(t=>t.items)),r=report(s);
 assert.equal(r.services.electricity.selected.cents,8300);assert.equal(r.services.water.selected.cents,5300);assert.equal(r.services.electricity.points.find(p=>p.month==='2026-09').cents,13300);assert.equal(r.services.electricity.points.find(p=>p.month==='2026-09').transactions,2);assert.equal(r.services.electricity.points.find(p=>p.month==='2026-10').cents,-2000);
 assert.equal(r.unclassified.at(-1).cents,1600);assert.equal(r.unclassified.at(-1).lines,2);assert.equal(r.services.electricity.difference,null);assert.equal(JSON.stringify(s),before);assert.deepEqual(F.expenses(s.transactions.flatMap(t=>t.items)),grand);
 s.recurringCharges.forEach(b=>b.amount=123456);assert.deepEqual(report(s),r);s.settings={waterdropPayback:{gallonsLogged:999},joshRent:99999};assert.deepEqual(report(s),r);
});
test('sparse history compares nearest recorded month, never absent zero; nonpositive priors have no percentage',()=>{
 const s=utilityFixture();s.transactions=s.transactions.filter(t=>!['unknown','mixed'].includes(t.id));let r=report(s);assert.equal(r.services.water.prior.month,'2026-09');assert.equal(r.services.water.difference,1000);assert.equal(r.services.water.percent,25);assert.equal(r.services.electricity.prior.month,'2026-10');assert.equal(r.services.electricity.difference,10100);assert.equal(r.services.electricity.percent,null);
 r=U.history(s,{...options,month:'2026-10'});assert.equal(r.services.water.selected.cents,null);assert.equal(r.services.water.difference,null);assert.equal(r.services.electricity.difference,-15300);assert.equal(r.services.electricity.percent,-15300/13300*100);assert.equal(r.services.water.current.cents,5000);
 s.transactions.push(payment('zero','2026-10-12',[item(40,{adjustment:40,status:'returned'})],'water'));r=report(s);assert.equal(r.services.water.prior.cents,0);assert.equal(r.services.water.percent,null);assert.equal(r.services.water.difference,5000);assert.equal(r.services.water.points.find(p=>p.month==='2026-10').transactions,1);
});
test('exact explicit classification only; never merchant/name guesses; mixed services leave generic amounts unallocated',()=>{
 const s={recurringCharges:[{id:'e',utilityType:'electricity'}],transactions:[payment('mixed','2026-11-01',[item(10,{category:'Electricity'}),item(20,{category:'Sewer'}),item(5)],'e'),payment('unknown','2026-11-02',[item(9,{name:'Electricity'})],null,{merchant:'Electricity'})]};const r=report(s);assert.equal(r.services.electricity.selected.cents,1000);assert.equal(r.services.water.selected.cents,2000);assert.equal(r.unclassified.at(-1).cents,1400);assert.equal(r.unclassified.at(-1).lines,2);
 s.transactions[1].items[0].category='Electricity';assert.equal(report(s).services.electricity.selected.cents,1900);s.transactions[1].items[0].bucket='groceries';assert.equal(report(s).services.electricity.selected.cents,1000);
});
test('fees/tax/deposits follow net expense semantics; non-expense statuses never create recorded zero months',()=>{
 const s={recurringCharges:[{id:'e',utilityType:'electricity'}],transactions:[payment('one','2026-11-01',[item(93),item(30,{bucket:'housing_one_time',setupClass:'lease_service_setup'}),item(5,{category:'Other',bucket:'tax'}),item(100,{bucket:'refundable_deposit',depositStatus:'held'}),item(80,{bucket:'refundable_deposit',depositStatus:'partially_refunded',depositRefunded:60}),...['avoided','cancelled','reused'].map(status=>item(1000,{status}))],'e',{oneTimeAmount:30})]};assert.equal(report(s).services.electricity.selected.cents,14800);
 s.transactions[0].items.push(item(10,{category:'Furniture',bucket:'housing_one_time'}));assert.equal(report(s).services.electricity.selected.cents,14300);assert.equal(report(s).unclassified.at(-1).cents,500);
 s.transactions=[payment('not-paid','2026-11-01',['avoided','cancelled','reused'].map(status=>item(100,{status})),'e')];assert.equal(report(s).services.electricity.selected.cents,null);
});
test('duplicate transactions and bill allocations counted once, separate identical line positions remain legitimate',()=>{
 const s=utilityFixture(),expected=report(s);s.transactions.push(structuredClone(s.transactions[0]));s.recurringCharges.push(structuredClone(s.recurringCharges[0]));let r=report(s);assert.deepEqual(r.services,expected.services);assert.equal(r.issues.duplicatesIgnored,1);
 s.transactions.push({...structuredClone(s.transactions[0]),items:[item(500)]});r=report(s);assert.equal(r.services.electricity.points.find(p=>p.month==='2026-08').cents,null);assert.equal(r.issues.conflictingTransactions,1);
 s.transactions=[payment('two-lines','2026-11-01',[item(10),item(10)],'electric')];r=report(s);assert.equal(r.services.electricity.selected.cents,2000);assert.equal(r.services.electricity.selected.transactions,1);
 s.recurringCharges.push({...s.recurringCharges[0],utilityType:'water'});r=report(s);assert.equal(r.services.electricity.selected.cents,null);assert.equal(r.unclassified.at(-1).cents,2000);
});
test('effective service classifications respect posting history; inactive bills still classify actual payments',()=>{
 const s={recurringCharges:[{id:'a',utilityType:'water',active:false}],housingFinance:{recurring_charge_revisions:[{recurring_charge_id:'a',effective_month:'2026-09',utility_type:'electricity'},{recurring_charge_id:'a',effective_month:'2026-11',utility_type:'water'}]},transactions:['2026-08','2026-09','2026-11'].map((m,i)=>payment('t'+i,m+'-01',[item(10)],'a'))};const r=report(s);assert.equal(r.services.electricity.points.find(p=>p.month==='2026-09').cents,1000);assert.equal(r.services.water.selected.cents,1000);assert.equal(r.unclassified.find(p=>p.month==='2026-08').cents,1000);
});
test('bounded chart window, calendar validation, future dates and completely empty history',()=>{
 const s=utilityFixture();s.transactions=[payment('future','2026-11-12',[item(100)],'electric'),payment('invalid','2026-02-30',[item(100)],'electric')];const r=report(s);assert.equal(r.window.length,12);assert.equal(r.window[0],'2025-12');assert.equal(r.issues.futureTransactions,1);assert.equal(r.issues.invalidDates,1);assert.equal(r.services.electricity.selected.cents,null);assert.equal(r.services.electricity.prior,null);assert.throws(()=>U.history(s,{month:'2026-13',today:'2026-11-11'}),/valid/);
});
test('derived history survives existing Backup v3/cloud mapping without added fields, mutations or changed grand totals',async()=>{
 const snapshot=await baselineFixture(),s=fromCloud(snapshot,snapshot.owner),bill=s.recurringCharges.find(b=>b.utilityType==='electricity');s.transactions.push(payment(crypto.randomUUID(),'2026-11-10',[item(123)],bill.id,{oneTimeAmount:30}));const before=JSON.stringify(s),b=await B.create(s,()=>null),r=report(s),rows=toCloud(s,snapshot.owner,snapshot.rows);for(const list of Object.values(rows))for(const row of list)Object.assign(row,{created_at:'2026-09-01T12:00:00.000Z',updated_at:'2026-09-01T12:00:00.000Z'});const remote=fromCloud({rows},snapshot.owner);assert.deepEqual(report(remote),r);assert.deepEqual(diff(rows,toCloud(remote,snapshot.owner,rows)),{});assert.deepEqual(report(B.runtimeState(b,'synthetic')),r);assert.equal((await B.create(s,()=>null)).integrity.stateSha256,b.integrity.stateSha256);assert.equal(JSON.stringify(s),before);
 const recognized=H.baseline(s,'2026-11',s.recurringCharges.map(b=>({...b,included:true}))),sumBefore=R.monthly(recognized,'2026-11','2026-11-11');report(recognized);assert.deepEqual(R.monthly(recognized,'2026-11','2026-11-11'),sumBefore);assert.deepEqual(F.expenses(s.transactions.flatMap(t=>t.items)),F.expenses(remote.transactions.flatMap(t=>t.items)));
});

test('bill-linked generic service fees/deposits included once, but unallocated in mixed purchases',()=>{
 const s={recurringCharges:[{id:'e',utilityType:'electricity'}],transactions:[payment('fee','2026-11-01',[item(93),item(30,{category:'Other',bucket:'housing_one_time',setupClass:'lease_service_setup'}),item(100,{category:'Other',bucket:'refundable_deposit',depositStatus:'held'}),item(20,{category:'Other',bucket:'refundable_deposit',depositStatus:'forfeited'})],'e',{oneTimeAmount:30})]};
 assert.equal(report(s).services.electricity.selected.cents,14300);assert.equal(report(s).unclassified.at(-1).lines,0);
 s.transactions[0].items.push(item(5,{category:'Groceries',bucket:'groceries'}));assert.equal(report(s).services.electricity.selected.cents,9300);assert.equal(report(s).unclassified.at(-1).cents,5000);assert.equal(report(s).unclassified.at(-1).lines,2);
 assert.equal(U.service('__proto__'),null);assert.equal(U.service('toString'),null);
});

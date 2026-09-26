import test from 'node:test';
import assert from 'node:assert/strict';
import Finance from '../finance-utils.js';
import Backup from '../backup-utils.js';
import {fixture} from './backup-fixture.cjs';
import {baselineFixture} from './cloud-fixture.mjs';
import {fromCloud,toCloud} from '../cloud/ledger-model.mjs';
import {receiptFixture} from './receipt-fixture.mjs';
import {createReview,reviewedTotals,transactionDraft,classifySelected} from '../cloud/receipt-draft.mjs';
import {parseExtraction} from '../server/receipt-schema.mjs';
test('mixed charged merchandise + separate tax reconciles without subtracting savings; raw data and repeated lines preserved',()=>{
 const original=structuredClone(receiptFixture),review=createReview(original);assert.deepEqual(reviewedTotals(review),{merchandise:7946,tax:530,receipt:8476,expected:8476,difference:0});const draft=transactionDraft(review);assert.equal(draft.date,'');assert.equal(draft.items.length,5);assert.deepEqual(draft.items.at(-1),{status:'kept',adjustment:'0',depositStatus:'held',depositRefunded:0,moveIn:false,prorated:false,name:'Sales tax',amount:'5.30',category:'Other',bucket:'tax',setupClass:'none'});assert.equal(draft.items.filter(i=>i.name==='GRAIN PACK').length,2);assert(draft.items.every(i=>i.adjustment==='0'&&!i.giftCardOffset&&!i.oneTimeAmount));assert.deepEqual(original,receiptFixture);
 const total=Finance.expenses(draft.items);assert.equal(total.expenses,84.76);assert.equal(total.tax,5.3);assert.equal(total.groceries,59.46);assert.equal(total.housing,20);assert.equal(total.utilities,0);assert.equal(total.refunds,0);
 const response={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(receiptFixture)}]}]};assert(!parseExtraction(response).warnings.some(w=>w.includes('do not reconcile')));
});
test('review edits, removal, bulk categories, unknown suggestions, invalid fields and no price multiplication',()=>{
 const d=createReview(receiptFixture);d.items[0].selected=d.items[1].selected=true;classifySelected(d,Finance.receiptDefaults('Cleaning'));assert(d.items.slice(0,2).every(i=>i.category==='Cleaning'&&i.bucket==='housing_one_time'&&i.changed&&!i.selected));d.items.pop();d.items[0].quantity='3';assert.equal(transactionDraft(d).items[0].amount,'15.00');assert.notEqual(reviewedTotals(d).difference,0);d.tax='';assert.throws(()=>transactionDraft(d),/Sales tax/);d.tax='0';d.items[0].total_price='1.001';assert.throws(()=>transactionDraft(d),/cent amount/);d.items[0].total_price='1';d.transaction_date='2026-02-30';assert.throws(()=>transactionDraft(d),/valid date/);d.transaction_date='';d.currency='EUR';assert.throws(()=>transactionDraft(d),/USD/);
 const unknown=createReview({...receiptFixture,items:[{...receiptFixture.items[0],suggested_category:'Household',suggested_bucket:'bad',suggested_setup_class:'bad'}]});assert.equal(unknown.items[0].category,'Other');assert.equal(unknown.items[0].bucket,'excluded');assert(!Finance.categories.includes('Household'));
});
test('tax is portable in Backup v3 and normal cloud mappings without changing benchmark or original metadata',async()=>{
 const f=fixture(),tax=transactionDraft(createReview(receiptFixture)).items.at(-1),before=Finance.benchmark(f.state.settings,f.state.recurringCharges);f.state.transactions[1].items.push(tax);const b=await Backup.create(f.state,f.get);await Backup.validate(b);assert.equal(b.state.transactions[1].items.at(-1).bucket,'tax');assert(!JSON.stringify(b).includes('suggested_category'));assert.deepEqual(Finance.benchmark(f.state.settings,f.state.recurringCharges),before);
 const base=await baselineFixture(),state=fromCloud(base,base.owner);state.transactions[0].items.push(tax);const rows=toCloud(state,base.owner,base.rows);const round=fromCloud({rows},base.owner);assert.equal(round.transactions.find(t=>t.id===state.transactions[0].id).items.at(-1).bucket,'tax');assert.equal(Finance.expenses(round.transactions.flatMap(t=>t.items)).tax,5.30);
});

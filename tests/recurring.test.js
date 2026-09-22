const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const RecurringUtils=require('../recurring-utils.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const declaration=name=>name==='reconciledTransactions'?source.slice(source.indexOf('function reconciledTransactions('),source.indexOf("\n$('#seedBtn').onclick")):source.split('\n').find(line=>line.startsWith(`function ${name}(`)||line.startsWith(`const ${name}=`));
const context={RecurringUtils,crypto:require('node:crypto').webcrypto,localStorage:{getItem:()=>null},console};
vm.createContext(context);
vm.runInContext([source.split('\n').slice(0,7).join('\n'),...['normalizeSettings','inferSetupClass','validImageSource','normalizeTransactions','isKnownLegacyDemo','migrateLegacyDemoTransactions','migrateRecurringSpectrumToUtility','reconciledTransactions','load','nextMonthDate','inferBucket','netItem','depositReturned','depositExpense','monthItems','expenseTotalsForMonth','benchmarkTotalsForMonth'].map(declaration)].join('\n'),context);
const run=code=>vm.runInContext(code,context);
run(`var state=RecurringUtils.migrate(migrateRecurringSpectrumToUtility(load()));`);
assert.equal(run('state.recurringCharges.length'),2);
assert.equal(run('RecurringUtils.total(state.recurringCharges)'),1005);
const before=run('JSON.stringify(state.transactions)');
run('state=RecurringUtils.migrate(state); state=RecurringUtils.migrate(JSON.parse(JSON.stringify(state)));');
assert.equal(run('state.recurringCharges.length'),2);
assert.equal(run('JSON.stringify(state.transactions)'),before);
run(`state.recurringCharges=RecurringUtils.upsert(state.recurringCharges,{id:'electric',name:'Electricity',amount:93,category:'Utilities',utilityType:'electricity',kind:'estimated'});
state.transactions=[{id:'september-electric',date:'2026-09-05',merchant:'Electric company',items:[{name:'Electricity service',amount:'93',bucket:'utilities',status:'kept'},{name:'Electricity connection fee',amount:'30',bucket:'utilities',status:'kept',setupClass:'lease_service_setup'}]}];`);
let b=run("benchmarkTotalsForMonth('2026-09')");
assert.equal(b.utilities,123);assert.equal(b.expenses,123);assert.equal(b.housing,123);assert.equal(b.housing_one_time,0);
assert.equal(b.recurringRunRate,1098);assert.equal(b.benchmark,1450+718/68*30.4375);
const savings=b.monthlySavings;
run('state.transactions[0].items.pop()');
assert.equal(run("benchmarkTotalsForMonth('2026-09').monthlySavings"),savings);
run(`state.recurringCharges=RecurringUtils.upsert(state.recurringCharges,{...state.recurringCharges.find(b=>b.id==='electric'),amount:95});`);
assert.equal(run('RecurringUtils.total(state.recurringCharges)'),1100);
run("state.recurringCharges=RecurringUtils.deactivate(state.recurringCharges,'electric')");
assert.equal(run('RecurringUtils.total(state.recurringCharges)'),1005);
run('state=RecurringUtils.migrate(JSON.parse(JSON.stringify(state)))');
assert.equal(run('RecurringUtils.total(state.recurringCharges)'),1005);
const money=value=>`$${Number(value).toFixed(2)}`;
const migrated=RecurringUtils.migrate({settings:{rent50a:965},transactions:[]});
assert.equal(migrated.recurringCharges.length,1); // No invented internet bill.
let bills=RecurringUtils.upsert(migrated.recurringCharges,{id:'internet',name:'Internet',amount:40,category:'Internet',utilityType:'internet'});
bills=RecurringUtils.upsert(bills,{id:'electric',name:'Electricity',amount:93,category:'Utilities',utilityType:'electricity',kind:'estimated'});
assert.match(RecurringUtils.status(bills,money),/Internet \$40.00 \+ Electricity \$93.00 \(estimated\); water not set/);
assert.match(RecurringUtils.actualStatus([{name:'Electricity',bucket:'utilities',amount:123}],money),/Electricity \$123.00/);
assert.equal(RecurringUtils.total(RecurringUtils.migrate({recurringCharges:[],transactions:[],settings:{rent50a:965}}).recurringCharges),0);
assert.throws(()=>RecurringUtils.upsert([],{name:'Invalid',category:'Housing',amount:Infinity}));
assert.throws(()=>RecurringUtils.upsert([],{name:'Invalid',category:'Housing',amount:-1}));
// Older local storage loads and normalizes without needing recurring fields.
context.localStorage.getItem=()=>JSON.stringify({datasetVersion:1,legacyDemoCleanupVersion:2,settings:{rent50a:965},transactions:[{id:'old',date:'2026-09-05',items:[{name:'Electricity',amount:'123',category:'Utilities',status:'kept'}]}],condition:[]});
assert.equal(run('load().transactions[0].items[0].amount'),'123');
assert.equal(run('load().transactions[0].items[0].bucket'),'utilities');
assert.equal(run('RecurringUtils.migrate(load()).recurringCharges.length'),1);
// Repeated explicitly recurring receipts become one obligation, using latest service amount.
const legacy={settings:{},transactions:[{date:'2026-08-01',items:[{name:'Spectrum monthly service',amount:40,bucket:'utilities',recurring:true}]},{date:'2026-09-01',items:[{name:'Spectrum monthly service',amount:45,bucket:'utilities',recurring:true}]}]};
assert.equal(RecurringUtils.migrate(legacy).recurringCharges.length,1);
assert.equal(RecurringUtils.total(RecurringUtils.migrate(legacy).recurringCharges),45);
console.log('Recurring migration, actual spending, run-rate, CRUD, legacy loading, and status tests passed');
console.log('Audit: rent $965 + internet $40 + electric $93 = $1,098; actual utilities $123; recurring savings $'+savings.toFixed(2));
// Existing Drive backup/merge retains bill IDs and newer deactivations.
run('const SYNC_SCHEMA_VERSION=1;');
for(const name of ['ensureSyncMeta','syncSettingsSnapshot','syncHash','markSyncDirty','buildSyncPayload','syncUpdatedAt','mergeSyncRecords','validateSyncPayload','applyRemoteMerge'])run(declaration(name));
run('state=RecurringUtils.migrate(load()); state.condition=[];');
assert.equal(run('buildSyncPayload().state.recurringCharges[0].id'),'recurring-legacy-rent');
run(`var remote=JSON.parse(JSON.stringify(buildSyncPayload()));remote.state.recurringCharges[0].active=false;remote.state.recurringCharges[0].updatedAt='2099-01-01T00:00:00Z';applyRemoteMerge(remote);`);
assert.equal(run('RecurringUtils.total(state.recurringCharges)'),0);
run('delete remote.state.recurringCharges; applyRemoteMerge(remote);');
assert.equal(run('state.recurringCharges.length'),1);
assert.equal(run('state.recurringCharges[0].active'),false);
const insurance=RecurringUtils.migrate({settings:{},transactions:[{date:'2026-09-01',items:[{name:"Renter's insurance",amount:12,bucket:'housing_recurring',recurring:true}]}]});
assert.equal(RecurringUtils.total(insurance.recurringCharges),12);
assert.equal(RecurringUtils.total(RecurringUtils.upsert([],{id:'free',name:'Free service',category:'Other',amount:0})),0);

// Annual projections must reconcile with the cent-rounded monthly value displayed.
context.localMonthKey=()=> '2026-09';
run(declaration('benchmarkTotals'));
run(`state=RecurringUtils.migrate(migrateRecurringSpectrumToUtility({...load(),recurringCharges:undefined,recurringChargesVersion:undefined}));
state.recurringCharges=RecurringUtils.upsert(state.recurringCharges,{id:'internet-audit',name:'Spectrum monthly service',amount:40,category:'Internet'});
state.recurringCharges=RecurringUtils.upsert(state.recurringCharges,{id:'electric-audit',name:'Electricity',amount:93,category:'Utilities'});
state.recurringCharges=RecurringUtils.upsert(state.recurringCharges,{id:'insurance-audit',name:"Renter's insurance",amount:21,category:'Insurance'});`);
const audit=run('benchmarkTotals()');
const display=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
assert.equal(audit.recurringRunRate,1119);
assert.equal(audit.benchmark,1450+718/(68/30.4375)); // Methodology remains full precision.
assert.equal(display(audit.benchmark),'$1,771.38');
assert.equal(audit.monthlySavings,652.38);
assert.equal(display(audit.monthlySavings),'$652.38');
assert.equal(display(audit.annual),'$7,828.56');
assert.equal(audit.annual,Math.round(audit.monthlySavings*100)*12/100);
assert.equal(audit.utilities,123);
assert.equal(run("state.recurringCharges.find(bill=>bill.id==='electric-audit').amount"),93);
console.log('Display audit: $1,771.38 - $1,119.00 = $652.38; $652.38 × 12 = $7,828.56');

// Single-entry variable payments use stable bill IDs and an explicit save-time update.
const payment=(id,amount,oneTimeAmount=0,recurringChargeId='electric-audit')=>({id,merchant:'Electric company',date:'2026-09-10',recurringChargeId,oneTimeAmount,items:[{name:'Electricity payment',amount:String(amount),bucket:'utilities',category:'Utilities',status:'kept'}]});
run("state.recurringCharges=RecurringUtils.upsert(state.recurringCharges,{...state.recurringCharges.find(b=>b.id==='electric-audit'),kind:'estimated'});state.transactions=[];");
context.payment=payment('payment-1',123,30);
run('state=RecurringUtils.saveTransaction(state,payment,{updateMonthlyEstimate:true});');
assert.equal(run('state.transactions.length'),1);
assert.equal(run('state.recurringCharges.length'),4);
assert.equal(run("benchmarkTotalsForMonth('2026-09').utilities"),123);
assert.equal(run('RecurringUtils.total(state.recurringCharges)'),1119);
assert.equal(run("state.recurringCharges.find(b=>b.id==='electric-audit').amount"),93);
assert.equal(run('state.transactions[0].oneTimeAmount'),30);
context.payment={...payment('payment-2',87.42),date:'2026-10-10'};
run('state=RecurringUtils.saveTransaction(state,payment,{updateMonthlyEstimate:true});');
assert.equal(run("state.recurringCharges.find(b=>b.id==='electric-audit').amount"),87.42);
assert.equal(run("benchmarkTotalsForMonth('2026-10').utilities"),87.42);
assert.equal(run('state.transactions.length'),2);
// Historical corrections are opt-in, even if the original save updated the estimate.
context.payment=payment('payment-1',125,30);
run('state=RecurringUtils.saveTransaction(state,payment);');
assert.equal(run("state.recurringCharges.find(b=>b.id==='electric-audit').amount"),87.42);
assert.equal(run('state.transactions.length'),2);
run('state.transactions=state.transactions.filter(t=>t.id!=="payment-1");');
assert.equal(run("state.recurringCharges.find(b=>b.id==='electric-audit').amount"),87.42);
context.payment=payment('payment-2',88,0);
run('state=RecurringUtils.saveTransaction(state,payment,{updateMonthlyEstimate:true});');
assert.equal(run("state.recurringCharges.find(b=>b.id==='electric-audit').amount"),88);
assert.equal(run('state.transactions.length'),1);
for(const invalid of [-1,124,Infinity,NaN]){
  context.payment=payment('invalid',123,invalid);
  const snapshot=run('JSON.stringify(state)');
  assert.throws(()=>run('RecurringUtils.saveTransaction(state,payment,{updateMonthlyEstimate:true})'),/One-time portion/);
  assert.equal(run('JSON.stringify(state)'),snapshot);
}
context.payment=payment('fixed',900,0,'recurring-legacy-rent');
run('state=RecurringUtils.saveTransaction(state,payment);');
assert.equal(run("state.recurringCharges.find(b=>b.id==='recurring-legacy-rent').amount"),965);
assert.throws(()=>run('RecurringUtils.saveTransaction(state,payment,{updateMonthlyEstimate:true})'),/Fixed monthly bills/);
context.payment=payment('inactive',90);
run("state.recurringCharges=RecurringUtils.deactivate(state.recurringCharges,'electric-audit');");
assert.throws(()=>run('RecurringUtils.saveTransaction(state,payment,{updateMonthlyEstimate:true})'),/active monthly bill/);
const legacyPayment={id:'unlinked',date:'2026-09-01',items:[{name:'Old electric',amount:'123',bucket:'utilities'}]};
context.payment=legacyPayment;
run('state=RecurringUtils.saveTransaction(state,payment);');
assert.equal(run('normalizeTransactions(state.transactions).find(t=>t.id==="unlinked").recurringChargeId'),undefined);
assert.equal(run('normalizeTransactions(state.transactions).find(t=>t.id==="unlinked").items[0].amount'),'123');
console.log('Variable bill payment, fixed-bill guard, invalid portions, legacy records, and historical edit/delete tests passed');

assert.equal(RecurringUtils.paymentPortion(payment('all-one-time',1.10,1.10)).recurringAmount,0);
assert.equal(RecurringUtils.paymentPortion({...payment('split',93,30),items:[{amount:'93',status:'kept'},{amount:'30',status:'kept'}]}).recurringAmount,93);

// Reported $75 case: an explicit update replaces the existing $93 estimate.
run(`state={...state,transactions:[],recurringCharges:[]};
for(const bill of [{id:'rent',name:'Rent',amount:965},{id:'internet',name:'Spectrum',amount:40},{id:'insurance',name:'Insurance',amount:21},{id:'electric-audit',name:'Electricity',amount:93,kind:'estimated'}])state.recurringCharges=RecurringUtils.upsert(state.recurringCharges,{category:'Housing',...bill});`);
context.payment=payment('reported-payment',75,0);
run('state=RecurringUtils.saveTransaction(state,payment,{updateMonthlyEstimate:true});');
assert.equal(run("benchmarkTotalsForMonth('2026-09').utilities"),75);
assert.equal(run("state.recurringCharges.find(b=>b.id==='electric-audit').amount"),75);
assert.equal(run('RecurringUtils.total(state.recurringCharges)'),1101);
assert.equal(run("benchmarkTotalsForMonth('2026-09').monthlySavings"),670.38);
context.payment=payment('reported-payment',123,30);
run('state=RecurringUtils.saveTransaction(state,payment,{updateMonthlyEstimate:true});');
assert.equal(run("benchmarkTotalsForMonth('2026-09').utilities"),123);
assert.equal(run("state.recurringCharges.find(b=>b.id==='electric-audit').amount"),93);
assert.equal(run('state.transactions.length'),1);

// The edit form must expose whether Save updates the estimate or only the payment.
const controls=Object.fromEntries(['#transactionBill','#variableBillFields','#transactionOneTime','#updateMonthlyEstimate','#transactionSaveEffect','#transactionBillHelp','#transactionEstimatePreview'].map(id=>[id,{value:'',checked:false,textContent:''}]));
const submitControl={textContent:''};
context.$=id=>controls[id];context.txForm={querySelector:()=>submitControl};
context.editingTransactionId='reported-payment';context.money=money;context.collectItems=()=>payment('preview',75).items;
controls['#transactionBill'].value='electric-audit';controls['#transactionOneTime'].value='0';
run(source.slice(source.indexOf('function refreshTransactionBill(){'),source.indexOf("\n$('#transactionBill').addEventListener")));
run('refreshTransactionBill()');
assert.equal(submitControl.textContent,'Save payment only');
assert.match(controls['#transactionSaveEffect'].textContent,/keep the monthly estimate at \$93.00/);
controls['#updateMonthlyEstimate'].checked=true;
run('refreshTransactionBill()');
assert.equal(submitControl.textContent,'Save payment + update estimate');
assert.match(controls['#transactionSaveEffect'].textContent,/from \$93.00 to \$75.00/);
controls['#transactionBill'].value='rent';
run('refreshTransactionBill()');
assert.equal(controls['#variableBillFields'].hidden,true);
assert.equal(submitControl.textContent,'Save changes');

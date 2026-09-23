import {createHash} from 'node:crypto';
import Backup from '../../backup-utils.js';
import Finance from '../../finance-utils.js';
export const SOURCE={sha256:'17d5d9ba7500b74f8064431dfbb5aac7a46712560adf8e7df211e575e9e25400',bytes:19243,state:'e14cd139ba471bc76eddd4e5bae079fff5a838d171e57586dbdca5fb88574d9a',manifest:'459f4c5869cec2bc1f39341577b46b62022bb1afd5155593049bf763932fee99'};
export const PROJECT='jhflrrurujgyvdezabxr';
export const NAMESPACE='50a-certified-import-v1';
export const TABLES=['recurring_charges','transactions','transaction_items','water_events','user_settings','benchmark_adjustments','property_condition','attachments'];
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function uuid(source,table,id){const b=createHash('sha256').update(JSON.stringify([NAMESPACE,source,table,id])).digest().subarray(0,16);b[6]=(b[6]&15)|128;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export function requireThat(ok,message){if(!ok)throw Error(message);}
export async function verifySource(bytes,authorized=SOURCE){
 requireThat(hash(bytes)===authorized.sha256,'Source raw-byte SHA-256 mismatch');
 requireThat(bytes.length===authorized.bytes,'Source size mismatch');
 let b;try{b=JSON.parse(bytes)}catch{throw Error('Invalid JSON')}
 const v=await Backup.validate(b);
 requireThat(v.restoreEquivalent&&b.format==='50a-ledger-backup'&&b.version===3,'Backup v3 validation failed');
 requireThat(b.integrity.stateSha256===authorized.state&&b.integrity.manifestSha256===authorized.manifest,'Embedded hash mismatch');
 return {backup:b,summary:v.summary};
}
export function money(v,scale=2){const n=Number(v??0);requireThat(Number.isFinite(n)&&n>=0&&n<10**(12-scale)&&Math.abs(n*10**scale-Math.round(n*10**scale))<1e-6,'Numeric value cannot be represented losslessly in schema');return n;}
export function mapSource(b,owner,sourceHash){
 requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner),'Invalid owner UUID');
 const s=b.state,st=s.settings,w=st.waterdropPayback;
 // Evidence requires a separately authorized source and a staged Storage adapter.
 requireThat(!s.condition.length&&!b.attachments.length&&!b.manifest.inlineEvidence.length&&s.transactions.every(t=>!t.attachmentIds.length&&!t.receipt),'Evidence import is not enabled for this certified migration');
 const rows=Object.fromEntries(TABLES.map(t=>[t,[]])),mapping=[];
 const base=(t,key)=>{const id=uuid(sourceHash,t,key);mapping.push({table:t,sourceKeySha256:hash(JSON.stringify(key)),cloudId:id});return {id,owner_id:owner}};
 rows.recurring_charges=s.recurringCharges.map(r=>({...base('recurring_charges',r.id),name:r.name,amount:money(r.amount),category:r.category,kind:r.kind,utility_type:r.utilityType,active:r.active}));
 for(const t of s.transactions){const tx={...base('transactions',t.id),merchant:t.merchant,transaction_date:t.date,notes:t.notes,recurring_charge_id:t.recurringChargeId?uuid(sourceHash,'recurring_charges',t.recurringChargeId):null,one_time_amount:money(t.oneTimeAmount),system_key:t.systemKey??null,sample_key:t.sampleKey??null};rows.transactions.push(tx);
 t.items.forEach((i,position)=>rows.transaction_items.push({...base('transaction_items',[t.id,position]),transaction_id:tx.id,position,description:i.name,amount:money(i.amount),category:i.category,bucket:i.bucket,setup_class:i.setupClass??'none',status:i.status,adjustment:money(i.adjustment),deposit_status:i.depositStatus??'held',deposit_refunded:money(i.depositRefunded),move_in:i.moveIn??false,prorated:i.prorated??false,estimated:i.estimated??false,recurring:i.recurring??false,gift_card_offset:money(i.giftCardOffset)}));}
 rows.water_events=w.waterdropCompletions.map(e=>{requireThat(e.completedAt===null||e.completedAt.includes('T'),'Date-only water event requires precision-preserving schema review');return {...base('water_events',e.id),completed_at:e.completedAt,gallons:1,legacy:e.legacy}});
 rows.user_settings=[{owner_id:owner,setup_budget:money(s.budget),forgotten_essentials_budget:money(st.forgottenEssentialsBudget),josh_rent:money(st.joshRent),josh_stay_days:st.joshStayDays,move_in_date:st.moveInDate,prorated_rent:money(st.proratedRent),admin_fee:money(st.adminFee),deposit_amount:money(st.depositAmount),deposit_status:st.depositStatus,deposit_refunded:money(st.depositRefunded),waterdrop_name:w.name,waterdrop_baseline_cost_per_gallon:money(w.baselineCostPerGallon,4),waterdrop_system_cost:money(w.systemCost),waterdrop_break_even_gallon:w.breakEvenGallon}];
 rows.benchmark_adjustments=st.joshAdjustments.map((a,position)=>({...base('benchmark_adjustments',position),label:a.label,amount:money(a.amount),position}));
 validateRows(rows,owner);return {rows,mapping};
}
export const counts=rows=>Object.fromEntries(TABLES.map(t=>[t,rows[t].length]));
export function validateRows(rows,owner){
 for(const t of TABLES){requireThat(rows[t].every(r=>r.owner_id===owner),`Owner mismatch: ${t}`);requireThat(new Set(rows[t].map(r=>r.id??r.owner_id)).size===rows[t].length,`Duplicate ID: ${t}`);}
 const tx=new Set(rows.transactions.map(r=>r.id)),rc=new Set(rows.recurring_charges.map(r=>r.id));
 requireThat(rows.transaction_items.every(r=>tx.has(r.transaction_id)),'Dangling item parent');requireThat(rows.transactions.every(r=>!r.recurring_charge_id||rc.has(r.recurring_charge_id)),'Dangling recurring association');
 for(const r of rows.transaction_items){requireThat(r.deposit_refunded<=r.amount,'Invalid item deposit refund');requireThat(r.description.trim().length>0,'Empty description');}
 requireThat(rows.user_settings.length===1,'Expected one settings row');
}
export function financials(rows){
 const items=rows.transaction_items.map(i=>({amount:i.amount,adjustment:i.adjustment,bucket:i.bucket,status:i.status,depositStatus:i.deposit_status,depositRefunded:i.deposit_refunded}));
 const septemberIds=new Set(rows.transactions.filter(t=>t.transaction_date.startsWith('2026-09')).map(t=>t.id));
 const sep=Finance.expenses(items.filter((_,n)=>septemberIds.has(rows.transaction_items[n].transaction_id)));
 const st=rows.user_settings[0];const bm=Finance.benchmark({joshRent:st.josh_rent,joshStayDays:st.josh_stay_days,joshAdjustments:rows.benchmark_adjustments},rows.recurring_charges);
 return Object.fromEntries(Object.entries({septemberExpenses:sep.expenses,septemberHousing:sep.housing,septemberUtilities:sep.utilities,septemberGroceries:sep.groceries,recurringRunRate:bm.recurringRunRate,monthlySavings:bm.monthlySavings,annualSavings:bm.annual,allPeriodExpenses:Finance.expenses(items).expenses}).map(([k,v])=>[k,Math.round(v*100)/100]));
}
export const EXPECTED={septemberExpenses:139.93,septemberHousing:123,septemberUtilities:123,septemberGroceries:16.93,recurringRunRate:1119,monthlySavings:652.38,annualSavings:7828.56,allPeriodExpenses:1524.52};
export const EXPECTED_COUNTS={recurring_charges:4,transactions:9,transaction_items:48,water_events:27,user_settings:1,benchmark_adjustments:2,property_condition:0,attachments:0};
export function assertCertified(rows,summary){requireThat(JSON.stringify(counts(rows))===JSON.stringify(EXPECTED_COUNTS),'Certified counts mismatch');requireThat(rows.recurring_charges.every(r=>r.active)&&summary.activeBills===4&&summary.inactiveBills===0&&summary.attachmentReferences===0&&summary.inlineEvidence===0,'Certified source summary mismatch');requireThat(JSON.stringify(financials(rows))===JSON.stringify(EXPECTED),'Certified financial checkpoints mismatch');}
export function normalizeRow(row){return Object.fromEntries(Object.entries(row).filter(([k])=>!['created_at','updated_at'].includes(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,k==='completed_at'&&v?new Date(v).toISOString():v]));}
export function semantic(rows){return Object.fromEntries(TABLES.map(t=>[t,rows[t].map(normalizeRow).sort((a,b)=>(a.id??a.owner_id).localeCompare(b.id??b.owner_id))]));}
export function reconcile(expected,actual,owner){validateRows(actual,owner);requireThat(JSON.stringify(semantic(expected))===JSON.stringify(semantic(actual)),'Cloud business projection mismatch');requireThat(JSON.stringify(financials(expected))===JSON.stringify(financials(actual)),'Cloud financial mismatch');return {counts:counts(actual),financials:financials(actual),relationships:'PASS',businessMeaning:'PASS'};}
export function destinationState(rows,planned,resume){const empty=TABLES.every(t=>rows[t].length===0);if(empty)return 'empty';requireThat(resume,'Nonempty destination refuses initial migration');reconcile(planned,rows,planned.user_settings[0].owner_id);return 'already-applied';}

// Catalog result ordering varies with database collation; compare definitions as sets.
export function schemaSignature(schema){return Backup.canonical(Object.fromEntries(Object.entries(schema).map(([k,rows])=>[k,rows.map(r=>Backup.canonical(r)).sort()])));}

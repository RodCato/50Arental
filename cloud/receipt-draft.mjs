import Finance from '../finance-utils.js';
// Pure, reusable review model. Never reads storage or mutates the extraction/ledger.
export const moneyCents=value=>{
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const n=Number(value);return Number.isFinite(n)&&n>=0&&n<1e10&&Math.abs(n*100-Math.round(n*100))<1e-6?Math.round(n*100):null;
};
const value=v=>v===null||v===undefined?'':String(v);
export function createReview(extraction){
 return {...Object.fromEntries(['merchant','transaction_date','transaction_time','currency','subtotal','tax','tip','discounts','total'].map(k=>[k,value(extraction[k])])),items:extraction.items.map((item,index)=>({description:item.description,total_price:value(item.total_price),quantity:value(item.quantity),unit_price:value(item.unit_price),sku:value(item.sku),raw_text:value(item.raw_text),category:Finance.categories.includes(item.suggested_category)?item.suggested_category:'Other',bucket:Finance.buckets.includes(item.suggested_bucket)&&item.suggested_bucket!=='tax'?item.suggested_bucket:'excluded',setupClass:item.suggested_bucket==='housing_one_time'&&Finance.setupClasses.includes(item.suggested_setup_class)?item.suggested_setup_class:'none',sourceIndex:index,selected:false,changed:false,suggested:!!(item.suggested_category||item.suggested_bucket) }))};
}
export function reviewedTotals(draft){
 const amounts=draft.items.map(i=>moneyCents(i.total_price)),tax=moneyCents(draft.tax),receipt=moneyCents(draft.total);
 const merchandise=amounts.every(n=>n!==null)?amounts.reduce((a,b)=>a+b,0):null;
 const expected=merchandise!==null&&tax!==null?merchandise+tax:null;
 return {merchandise,tax,receipt,expected,difference:expected!==null&&receipt!==null?receipt-expected:null};
}
export function classifySelected(draft,classification){
 if(!Finance.categories.includes(classification.category)||!Finance.buckets.includes(classification.bucket)||classification.bucket==='tax'||!Finance.setupClasses.includes(classification.setupClass))throw Error('Choose a valid merchandise classification.');
 for(const item of draft.items)if(item.selected)Object.assign(item,classification,{setupClass:classification.bucket==='housing_one_time'?classification.setupClass:'none',changed:true,selected:false});
}
export function transactionDraft(draft){
 if(draft.currency.trim()&&!/^USD$/i.test(draft.currency.trim()))throw Error('50A records USD amounts. Currency conversion is not supported.');
 const date=draft.transaction_date;
 if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))throw Error('Enter a valid date or leave it blank to keep the existing date.');
 if(!draft.items.length)throw Error('Add at least one purchased item.');
 const base={status:'kept',adjustment:'0',depositStatus:'held',depositRefunded:0,moveIn:false,prorated:false};
 const items=draft.items.map(item=>{
  const cents=moneyCents(item.total_price);
  if(!item.description.trim()||cents===null)throw Error('Every item needs a description and a non-negative cent amount.');
  if(item.quantity!==''&&(!Number.isFinite(Number(item.quantity))||Number(item.quantity)<=0))throw Error('Quantity must be positive or blank. Item amounts are already line totals.');
  if(!Finance.categories.includes(item.category)||!Finance.buckets.includes(item.bucket)||item.bucket==='tax'||!Finance.setupClasses.includes(item.setupClass))throw Error('Review the item classifications.');
  return {...base,name:item.description.trim(),amount:(cents/100).toFixed(2),category:item.category,bucket:item.bucket,setupClass:item.bucket==='housing_one_time'?item.setupClass:'none'};
 });
 const tax=moneyCents(draft.tax);if(tax===null)throw Error('Verify Sales tax: enter an amount, including 0 if no tax was charged.');
 if(tax>0)items.push({...base,name:'Sales tax',amount:(tax/100).toFixed(2),category:'Other',bucket:'tax',setupClass:'none'});
 return {merchant:draft.merchant,date,items};
}

import Finance from '../finance-utils.js';
import {createReview,reviewedTotals,transactionDraft,classifySelected} from './receipt-draft.mjs';
// All controls edit a separate runtime draft; raw extraction remains unchanged.
export function reviewForm(root,data,{apply,currentCount}){
 const draft=createReview(data.extraction),form=document.createElement('form');form.className='receipt-review-form';root.replaceChildren(form);
 const element=(parent,tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent.append(e);return e;};
 const button=(parent,label,work)=>{const b=element(parent,'button',label);b.type='button';b.className='ghost';b.onclick=work;return b;};
 const input=(parent,label,value,change,{type='text',key}={})=>{const wrap=element(parent,'label',label),i=element(wrap,'input');i.type=type;i.value=value;i.setAttribute('aria-label',label);if(key)i.dataset.reviewField=key;if(type==='number'){if(key!=='discounts')i.min='0';i.step='0.01';i.inputMode='decimal';}i.oninput=()=>{change(i.value);ack.checked=false;reconcile()};return i;};
 const select=(parent,label,values,value,change)=>{const wrap=element(parent,'label',label),s=element(wrap,'select');s.setAttribute('aria-label',label);for(const v of values)s.add(new Option(v.replaceAll('_',' '),v));s.value=value;s.onchange=()=>{change(s.value);ack.checked=false;reconcile()};return s;};
 element(form,'h3','Review receipt · unsaved draft');element(form,'p','Apply opens the normal transaction editor. Only Save transaction saves financial data. Amounts are charged line totals; quantity does not multiply them.');
 const fields=element(form,'div');fields.className='receipt-fields';
 for(const [key,label,type] of [['merchant','Merchant','text'],['transaction_date','Date (blank keeps existing)','date'],['subtotal','Receipt merchandise subtotal','number'],['total','Receipt total','number']])input(fields,label,draft[key],v=>draft[key]=v,{type,key});
 if(!draft.transaction_date)element(form,'p','Date was not readable. Leave blank to keep the transaction date.');
 const taxBox=element(form,'section');taxBox.className='receipt-tax';element(taxBox,'h3','Sales tax · system-generated component');element(taxBox,'p','Other / tax / not setup. Adds to total expenses only; never allocated into item prices.');input(taxBox,'Sales tax',draft.tax,v=>draft.tax=v,{type:'number',key:'tax'});
 const bulk=element(form,'fieldset');element(bulk,'legend','Assign selected items');const bulkClass=Finance.receiptDefaults('Groceries');
 let bulkBucket,bulkSetup;select(bulk,'Bulk category',Finance.categories,bulkClass.category,v=>{Object.assign(bulkClass,Finance.receiptDefaults(v));bulkBucket.value=bulkClass.bucket;bulkSetup.value='none';});bulkBucket=select(bulk,'Bulk bucket',Finance.buckets.filter(b=>b!=='tax'),bulkClass.bucket,v=>bulkClass.bucket=v);bulkSetup=select(bulk,'Bulk setup class',Finance.setupClasses,'none',v=>bulkClass.setupClass=v);
 button(bulk,'Select all',()=>{draft.items.forEach(i=>i.selected=true);renderItems()});button(bulk,'Clear selection',()=>{draft.items.forEach(i=>i.selected=false);renderItems()});button(bulk,'Assign selected',()=>{classifySelected(draft,bulkClass);ack.checked=false;renderItems();reconcile()});
 const items=element(form,'div');items.className='receipt-items';
 function renderItems(){items.replaceChildren();draft.items.forEach((item,index)=>{
  const card=element(items,'section');card.className='receipt-item';card.dataset.reviewItem=String(index);
  const label=element(card,'label',`Item ${index+1}`),check=element(label,'input');label.className='receipt-item-select';check.type='checkbox';check.checked=item.selected;check.setAttribute('aria-label',`Select item ${index+1}`);check.onchange=()=>item.selected=check.checked;
  const origin=element(card,'small',item.changed?'User changed':item.suggested?'AI suggested · verify':'Needs classification review');origin.dataset.suggestion='';const changed=()=>{item.changed=true;origin.textContent='User changed'};
  input(card,'Description',item.description,v=>{item.description=v;changed()});input(card,'Charged item total',item.total_price,v=>{item.total_price=v;changed()},{type:'number'});
  const classification=element(card,'details');classification.className='receipt-classification';element(classification,'summary','Bucket / setup class');let bucket,setup;select(card,'Category',Finance.categories,item.category,v=>{Object.assign(item,Finance.receiptDefaults(v));bucket.value=item.bucket;setup.value=item.setupClass;changed()});bucket=select(classification,'Bucket',Finance.buckets.filter(b=>b!=='tax'),item.bucket,v=>{item.bucket=v;if(v!=='housing_one_time'){item.setupClass='none';setup.value='none'}changed()});setup=select(classification,'Setup class',Finance.setupClasses,item.setupClass,v=>{item.setupClass=v;changed()});
  card.append(classification);const detail=element(card,'details');element(detail,'summary','Item details');for(const [key,label,type] of [['quantity','Quantity','number'],['unit_price','Unit price (reference only)','number'],['sku','SKU','text'],['raw_text','Readable text','text']])input(detail,label,item[key],v=>{item[key]=v;changed()},{type});
  button(card,'Remove item',()=>{draft.items.splice(index,1);ack.checked=false;renderItems();reconcile()});
 });}
 button(form,'Add missing item',()=>{draft.items.push({description:'',total_price:'',quantity:'',unit_price:'',sku:'',raw_text:'',...Finance.receiptDefaults('Other'),changed:true,suggested:false,selected:false});renderItems();ack.checked=false;reconcile()});
 const reconciliation=element(form,'p');reconciliation.setAttribute('role','status');reconciliation.dataset.reconciliation='';
 const warnings=element(form,'section');element(warnings,'h3','Warnings');const warningsList=element(warnings,'ul');for(const warning of data.extraction.warnings)element(warningsList,'li',warning);
 element(warnings,'p','Receipt savings are informational and never deducted again. Blank tax must be verified before Apply.');
 const ackLabel=element(form,'label','I reviewed the difference or unreadable total and will verify it in the transaction editor.'),ack=element(ackLabel,'input');ack.type='checkbox';ack.dataset.reconcileAck='';
 function reconcile(){const t=reviewedTotals(draft),money=n=>n===null?'Not readable':`$${(n/100).toFixed(2)}`;reconciliation.textContent=`Merchandise/items: ${money(t.merchandise)} · Tax: ${money(t.tax)} · Receipt total: ${money(t.receipt)} · Expected transaction total: ${money(t.expected)} · Difference: ${money(t.difference)}. ${t.difference===0?'Reconciled; savings not deducted again.':'Verify the remaining difference; no balancing adjustment will be invented.'}`;ackLabel.hidden=t.difference===0;}
 const details=element(form,'details');element(details,'summary','Extraction details');
 for(const [key,label,type] of [['transaction_time','Receipt time (reference only)','text'],['currency','Currency (50A uses USD)','text'],['tip','Tip (reference only; add a reviewed item if needed)','number'],['discounts','Receipt savings (informational only)','number']])input(details,label,draft[key],v=>draft[key]=v,{type,key});
 element(details,'p','Quantity, unit price, SKU, raw text, time and receipt checkpoints are review-only. Saved amounts are line totals. Confidence is not measured.');
 for(const [key,value] of Object.entries(data.usage))element(details,'p',`${key}: ${value??'Unavailable'}`);
 const raw=element(details,'details');element(raw,'summary','Original extraction (unchanged)');element(raw,'pre',JSON.stringify(data.extraction,null,2));
 element(form,'p',`This transaction currently has ${currentCount} line item(s). Apply requires explicit replacement confirmation and does not save.`);
 const bar=element(form,'div');bar.className='receipt-apply-bar';const error=element(bar,'p');error.setAttribute('role','alert');const submit=element(bar,'button','Apply to transaction');submit.type='submit';submit.className='accent';submit.dataset.applyReceipt='';
 form.onsubmit=event=>{event.preventDefault();error.textContent='';try{const next=transactionDraft(draft);if(reviewedTotals(draft).difference!==0&&!ack.checked)throw Error('Review and acknowledge the remaining difference or unreadable receipt total.');if(!confirm(`Replace the existing ${currentCount} draft line item(s) with ${next.items.length} reviewed line item(s), including sales tax if charged? Nothing is saved until Save transaction.`))return;apply(next);}catch(e){error.textContent=e.message;}};
 renderItems();reconcile();return draft;
}

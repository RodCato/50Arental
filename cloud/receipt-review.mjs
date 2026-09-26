// Ephemeral read-only review. This module never calls ledger/evidence mutation APIs.
export function receiptReview(client,{allowed,owner,getTransaction,mountImage}){
 const dialog=document.createElement('dialog');dialog.id='receiptReview';dialog.setAttribute('aria-labelledby','receiptReviewTitle');
 dialog.innerHTML=`<div class="dialog-form"><div class="dialog-heading"><h2 id="receiptReviewTitle">Receipt analysis</h2><button type="button" class="ghost" data-close>Close</button></div><p>Read-only preview. Selected receipt images are sent to OpenAI only when you press Analyze receipt. Results are not saved or applied to your ledger.</p><p>Select up to 4 images (20 MiB combined). Put portions of the same receipt in reading order.</p><div data-images></div><label class="receipt-confirm" hidden><input type="checkbox" data-same> These selected images are portions of the same receipt.</label><button type="button" class="accent" data-analyze>Analyze receipt</button><p role="status" aria-live="polite" data-status></p><div data-result></div></div>`;
 document.body.append(dialog);
 const find=s=>dialog.querySelector(s),list=find('[data-images]'),result=find('[data-result]'),status=find('[data-status]'),analyze=find('[data-analyze]'),same=find('[data-same]');
 let images=[],cleanups=[],controller=null,epoch=0,openedOwner=null,busy=false,failed=false;
 const clearImages=()=>{cleanups.splice(0).forEach(f=>f());list.replaceChildren()};
 const reset=()=>{epoch++;controller?.abort();controller=null;busy=false;failed=false;images=[];openedOwner=null;clearImages();result.replaceChildren();status.textContent='';same.checked=false;};
 dialog.addEventListener('close',reset);find('[data-close]').onclick=()=>dialog.close();
 function update(){const count=images.filter(i=>i.selected).length;same.closest('label').hidden=count<2;same.disabled=busy;analyze.disabled=busy||!count||count>4||(count>1&&!same.checked);analyze.textContent=busy?'Analyzing…':failed?'Retry':'Analyze receipt';list.querySelectorAll('button,input').forEach(e=>e.disabled=busy||e.dataset.boundary==='true');}
 same.onchange=update;
 function renderImages(){clearImages();images.forEach((item,index)=>{
  const row=document.createElement('div');row.className='receipt-select';
  const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=item.selected;input.setAttribute('aria-label',`Select image ${item.number}`);input.onchange=()=>{item.selected=input.checked;same.checked=false;result.replaceChildren();status.textContent='';update()};label.append(input,`Image ${item.number}`);
  const thumb=document.createElement('span');row.append(label,thumb);list.append(row);cleanups.push(mountImage(thumb,item.id,`Receipt image ${item.number}`));
  for(const [text,delta] of [['Move up',-1],['Move down',1]]){const button=document.createElement('button');button.type='button';button.className='ghost compact';button.textContent=text;button.setAttribute('aria-label',`${text} image ${item.number}`);button.dataset.boundary=String(index+delta<0||index+delta>=images.length);button.onclick=()=>{result.replaceChildren();status.textContent='';[images[index],images[index+delta]]=[images[index+delta],images[index]];renderImages()};row.append(button);}
 });update();}
 const text=(parent,tag,value)=>{const element=document.createElement(tag);element.textContent=value;parent.append(element);return element;};
 function show(data){result.replaceChildren();const e=data.extraction;const display=v=>v===null?'Not readable':String(v);
  text(result,'h3','Extracted receipt · not saved');const fields=document.createElement('dl');result.append(fields);
  for(const [key,label] of [['merchant','Merchant'],['transaction_date','Date'],['transaction_time','Time'],['currency','Currency'],['subtotal','Subtotal'],['tax','Tax'],['tip','Tip'],['discounts','Discounts'],['total','Total']]){text(fields,'dt',label);text(fields,'dd',display(e[key]));}
  text(result,'h3','Items');const items=document.createElement('ol');result.append(items);
  for(const item of e.items){const li=document.createElement('li');items.append(li);text(li,'strong',item.description);for(const [key,label] of [['quantity','Quantity'],['unit_price','Unit price'],['total_price','Total price'],['sku','SKU'],['raw_text','Visible text']])text(li,'p',`${label}: ${display(item[key])}`);}
  if(!e.items.length)text(result,'p','No readable items returned.');text(result,'h3','Warnings');const warnings=document.createElement('ul');result.append(warnings);for(const warning of e.warnings)text(warnings,'li',warning);if(!e.warnings.length)text(result,'p','No warnings returned. Verify all fields against the images.');text(result,'p','Confidence: not measured. This is an extraction for human review, not a verified receipt.');
  const details=document.createElement('details');result.append(details);text(details,'summary','Model and usage');for(const [key,label] of [['model','Model'],['input_tokens','Input tokens'],['output_tokens','Output tokens'],['total_tokens','Total tokens']])text(details,'p',`${label}: ${data.usage[key]??'Unavailable'}`);
 }
 analyze.onclick=async()=>{
  if(busy||analyze.disabled||!allowed()||owner()!==openedOwner)return;
  const attempt=++epoch,selected=images.filter(i=>i.selected).map(i=>i.id);controller=new AbortController();const abort=controller;busy=true;failed=false;result.replaceChildren();status.textContent='Analyzing selected images. No ledger data will change.';update();
  const timer=setTimeout(()=>abort.abort(),65000);
  try{
   const {data,error}=await client.auth.getSession();if(error||!data.session?.access_token||data.session.user?.id!==openedOwner)throw Error('Sign in again before analyzing.');
   if(attempt!==epoch||!allowed()||owner()!==openedOwner)return;
   const response=await fetch('/api/receipt-ocr',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({attachment_ids:selected}),signal:abort.signal});
   let dataOut;try{dataOut=await response.json()}catch{throw Error('Analysis returned an invalid response. Retry when connected.');}
   if(attempt!==epoch||!allowed()||owner()!==openedOwner)return;
   if(!response.ok)throw Error(dataOut.error?.message||'Receipt analysis failed. Retry when connected.');
   show(dataOut);status.textContent='Analysis complete. Review against the original receipt. Nothing was saved.';
  }catch(error){if(attempt===epoch){failed=true;result.replaceChildren();status.textContent=error.name==='AbortError'?'Analysis timed out. Retry is manual; the previous request may still incur usage.':error.message;}}
  finally{clearTimeout(timer);if(attempt===epoch){controller=null;busy=false;update();}}
 };
 document.addEventListener('click',event=>{const button=event.target.closest('[data-analyze-receipt]');if(!button||!allowed()||dialog.open)return;const transaction=getTransaction(button.dataset.analyzeReceipt);if(!transaction?.attachmentIds?.length)return;reset();openedOwner=owner();images=transaction.attachmentIds.map((id,index)=>({id,number:index+1,selected:index===0}));renderImages();dialog.showModal();});
 client.auth.onAuthStateChange((_event,session)=>{if(openedOwner&&session?.user?.id!==openedOwner){dialog.close();reset();}});
 window.addEventListener('pagehide',()=>{dialog.close();reset()});
 return {close:()=>{dialog.close();reset()}};
}

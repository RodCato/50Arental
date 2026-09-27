import {prepareImage} from './evidence.mjs';
import {reviewForm} from './receipt-review-form.mjs';
// Ephemeral read-only review. This module never calls ledger/evidence mutation APIs.
export function receiptReview(client,{allowed,owner,getTransaction,mountImage,applyDraft,getDraft}){
 const dialog=document.createElement('dialog');dialog.id='receiptReview';dialog.setAttribute('aria-labelledby','receiptReviewTitle');
 dialog.innerHTML=`<div class="dialog-form"><div class="dialog-heading"><h2 id="receiptReviewTitle">Receipt analysis</h2><button type="button" class="ghost" data-close>Close</button></div><p>Editable review. Selected receipt images are sent to OpenAI only when you press Analyze receipt. Apply opens an unsaved transaction draft; only the normal Save transaction action writes to your ledger.</p><p><span data-limit>Select up to 4 images (20 MiB combined).</span> Put portions of the same receipt in reading order.</p><div data-images></div><label class="receipt-confirm" hidden><input type="checkbox" data-same> These selected images are portions of the same receipt.</label><button type="button" class="accent" data-analyze>Analyze receipt</button><p role="status" aria-live="polite" data-status></p><div data-result></div></div>`;
 document.body.append(dialog);
 const find=s=>dialog.querySelector(s),list=find('[data-images]'),result=find('[data-result]'),status=find('[data-status]'),analyze=find('[data-analyze]'),same=find('[data-same]');
 let draftSource=null,transactionId=null,expected=null,currentCount=0,images=[],cleanups=[],controller=null,epoch=0,openedOwner=null,busy=false,failed=false;
 const clearImages=()=>{cleanups.splice(0).forEach(f=>f());list.replaceChildren()};
 const reset=()=>{epoch++;controller?.abort();controller=null;busy=false;failed=false;images=[];draftSource=null;openedOwner=null;transactionId=null;expected=null;currentCount=0;clearImages();result.replaceChildren();status.textContent='';same.checked=false;};
 dialog.addEventListener('close',reset);find('[data-close]').onclick=()=>dialog.close();
 function update(){const count=images.filter(i=>i.selected).length;same.closest('label').hidden=count<2;same.disabled=busy;analyze.disabled=!navigator.onLine||busy||!count||count>4||(count>1&&!same.checked);analyze.textContent=busy?'Analyzing…':failed?'Retry':'Analyze receipt';list.querySelectorAll('button,input').forEach(e=>e.disabled=busy||e.dataset.boundary==='true');}
 same.onchange=update;window.addEventListener('offline',()=>{if(dialog.open){status.textContent='Receipt analysis requires a connection.';update()}});window.addEventListener('online',update);
 function renderImages(){clearImages();images.forEach((item,index)=>{
  const row=document.createElement('div');row.className='receipt-select';
  const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=item.selected;input.setAttribute('aria-label',`Select image ${item.number}`);input.onchange=()=>{item.selected=input.checked;same.checked=false;result.replaceChildren();status.textContent='';update()};label.append(input,`Image ${item.number}`);
  const thumb=document.createElement('span');row.append(label,thumb);list.append(row);if(item.blob){const img=document.createElement('img'),url=URL.createObjectURL(item.blob);img.src=url;img.alt=`Draft receipt image ${item.number}`;img.className='attachment-thumb';thumb.append(img);cleanups.push(()=>URL.revokeObjectURL(url));}else cleanups.push(mountImage(thumb,item.id,`Receipt image ${item.number}`));
  for(const [text,delta] of [['Move up',-1],['Move down',1]]){const button=document.createElement('button');button.type='button';button.className='ghost compact';button.textContent=text;button.setAttribute('aria-label',`${text} image ${item.number}`);button.dataset.boundary=String(index+delta<0||index+delta>=images.length);button.onclick=()=>{result.replaceChildren();status.textContent='';[images[index],images[index+delta]]=[images[index+delta],images[index]];renderImages()};row.append(button);}
 });update();}
 function show(data){reviewForm(result,data,{currentCount,unsaved:!!draftSource,apply:next=>{if(!allowed()||owner()!==openedOwner)throw Error('Sign in again.');if(draftSource){draftSource.apply(next);dialog.close();return;}const current=getTransaction(transactionId);if(!current||JSON.stringify(current)!==expected)throw Error('Transaction changed. Close and reopen receipt review.');applyDraft(transactionId,next,expected);dialog.close();}});}

 analyze.onclick=async()=>{
  if(busy||analyze.disabled||!allowed()||owner()!==openedOwner)return;
  const attempt=++epoch,selected=images.filter(i=>i.selected);controller=new AbortController();const abort=controller;busy=true;failed=false;result.replaceChildren();status.textContent='Analyzing selected images. No ledger data will change.';update();
  const timer=setTimeout(()=>abort.abort(),65000);
  try{
   const {data,error}=await client.auth.getSession();if(error||!data.session?.access_token||data.session.user?.id!==openedOwner)throw Error('Sign in again before analyzing.');
   if(attempt!==epoch||!allowed()||owner()!==openedOwner)return;
   if(draftSource&&!draftSource.valid())throw Error('Transaction or receipt changed. Close and reopen receipt review.');
   let body,headers={Authorization:`Bearer ${data.session.access_token}`};
   if(draftSource){if(selected.reduce((sum,i)=>sum+i.blob.size,0)>4*1024*1024)throw Error('Choose fewer photos: draft analysis allows 4 MiB combined after compression.');body=new FormData();selected.forEach(i=>body.append('images',i.blob,'receipt.'+i.blob.type.split('/')[1]));}
   else{headers['Content-Type']='application/json';body=JSON.stringify({attachment_ids:selected.map(i=>i.id)});}
   const response=await fetch(draftSource?'/api/receipt-ocr-draft':'/api/receipt-ocr',{method:'POST',cache:'no-store',headers,body,signal:abort.signal});
   let dataOut;try{dataOut=await response.json()}catch{throw Error('Analysis returned an invalid response. Retry when connected.');}
   if(attempt!==epoch||!allowed()||owner()!==openedOwner)return;
   if(!response.ok)throw Error(dataOut.error?.message||'Receipt analysis failed. Retry when connected.');
   if(draftSource&&!draftSource.valid())throw Error('Transaction or receipt changed. Close and reopen receipt review.');
   show(dataOut);status.textContent='Analysis complete. Review against the original receipt. Nothing was saved.';
  }catch(error){if(attempt===epoch){failed=true;result.replaceChildren();status.textContent=error.name==='AbortError'?'Analysis timed out. Retry is manual; the previous request may still incur usage.':error.message;}}
  finally{clearTimeout(timer);if(attempt===epoch){controller=null;busy=false;update();}}
 };
 document.addEventListener('click',async event=>{
  if(event.target.closest('#analyzeDraftReceipt')){
   if(!getDraft||!allowed()||dialog.open||!navigator.onLine)return;
   reset();const preparing=epoch;try{draftSource=getDraft();currentCount=draftSource.currentCount;openedOwner=owner();const source=draftSource,attempt=epoch;busy=true;find('[data-limit]').textContent='Select up to 4 draft images (4 MiB combined after compression). No cloud storage before Save.';dialog.showModal();status.textContent='Preparing receipt previews…';update();
    const prepared=[];for(const file of source.files){if(attempt!==epoch)return;prepared.push(await prepareImage(file));}
    if(attempt!==epoch||!allowed()||owner()!==openedOwner)return;if(!source.valid())throw Error('Transaction or receipt changed. Close and reopen receipt review.');
    images=prepared.map((blob,index)=>({blob,number:index+1,selected:index<4}));busy=false;status.textContent='';renderImages();
   }catch(error){if(preparing===epoch){busy=false;status.textContent=error.message;update();}}return;
  }
const button=event.target.closest('[data-analyze-receipt]');if(!button||!allowed()||dialog.open)return;const transaction=getTransaction(button.dataset.analyzeReceipt);if(!transaction?.attachmentIds?.length)return;if(transaction.systemKey)return;reset();find('[data-limit]').textContent='Select up to 4 saved images (20 MiB combined).';transactionId=transaction.id;expected=JSON.stringify(transaction);currentCount=transaction.items.length;openedOwner=owner();images=transaction.attachmentIds.map((id,index)=>({id,number:index+1,selected:index===0}));renderImages();dialog.showModal();});
 client.auth.onAuthStateChange((_event,session)=>{if(openedOwner&&session?.user?.id!==openedOwner){dialog.close();reset();}});
 window.addEventListener('pagehide',()=>{dialog.close();reset()});
 return {close:()=>{dialog.close();reset()}};
}

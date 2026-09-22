/* Monthly obligations are independent of paid transactions. No payment is generated here. */
(function(root){
  const VERSION=1;
  const active=records=>(records||[]).filter(record=>record.active!==false);
  const total=records=>active(records).reduce((cents,record)=>cents+Math.round(Number(record.amount)*100),0)/100;
  function utilityType(item){
    const text=`${item.name||''} ${item.category||''}`.toLowerCase();
    if(/electric/.test(text))return 'electricity';
    if(/internet|spectrum/.test(text))return 'internet';
    if(/water|sewer/.test(text))return 'water';
    return '';
  }
  function upsert(records,input,now=new Date().toISOString()){
    const amount=Number(input.amount),name=String(input.name||'').trim(),category=String(input.category||'').trim();
    if(!name||!category||String(input.amount).trim()===''||!Number.isFinite(amount)||amount<0)throw new Error('Enter a name, category, and a non-negative monthly amount.');
    const prior=(records||[]).find(record=>record.id===input.id);
    const record={...prior,id:prior?.id||input.id||crypto.randomUUID(),name,amount:Math.round(amount*100)/100,category,kind:input.kind==='estimated'?'estimated':'fixed',utilityType:String(input.utilityType||''),active:input.active!==false,createdAt:prior?.createdAt||now,updatedAt:now};
    return prior?records.map(item=>item.id===record.id?record:item):[...(records||[]),record];
  }
  function deactivate(records,id,now=new Date().toISOString()){
    return records.map(record=>record.id===id?{...record,active:false,updatedAt:now}:record);
  }
  function migrate(saved){
    // An existing collection, including an intentionally empty one, is authoritative.
    if(Array.isArray(saved.recurringCharges))return {...saved,recurringChargesVersion:VERSION};
    if(saved.recurringChargesVersion>=VERSION)return {...saved,recurringCharges:[]};
    let records=[];
    const now=new Date().toISOString();
    if(Number.isFinite(Number(saved.settings?.rent50a)))records=upsert(records,{id:'recurring-legacy-rent',name:'Rent',amount:saved.settings.rent50a,category:'Housing',kind:'fixed'},now);
    const latest=new Map();
    for(const tx of [...(saved.transactions||[])].sort((a,b)=>String(a.date).localeCompare(String(b.date)))){
      for(const item of tx.items||[]){
        if(!item.recurring||item.prorated||/^(50a\s+)?(monthly\s+)?rent$/i.test(String(item.name||'').trim())||['avoided','cancelled','reused','returned','refunded'].includes(item.status)||item.setupClass&&item.setupClass!=='none')continue;
        if(!['housing_recurring','utilities'].includes(item.bucket))continue;
        const key=String(item.name||'').trim().toLowerCase();
        if(key)latest.set(key,item);
      }
    }
    for(const [key,item] of latest){
      // Migrate only explicitly recurring service lines; never infer a bill from a total paid.
      records=upsert(records,{id:`recurring-legacy-${encodeURIComponent(key)}`,name:item.name,amount:item.amount,category:item.category||'Housing',kind:item.estimated?'estimated':'fixed',utilityType:utilityType(item)},now);
    }
    return {...saved,recurringCharges:records,recurringChargesVersion:VERSION};
  }
  function status(records,money){
    const bills=active(records),missing=['internet','electricity','water'].filter(type=>!bills.some(bill=>bill.utilityType===type));
    const summary=bills.length?bills.map(bill=>`${bill.name} ${money(bill.amount)}${bill.kind==='estimated'?' (estimated)':''}`).join(' + '):'No active monthly bills';
    return `${summary}${missing.length?`; ${missing.join(', ')} not set`:''}`;
  }
  function actualStatus(items,money){
    const paid=items.filter(item=>item.bucket==='utilities'&&!['avoided','cancelled','reused'].includes(item.status));
    return paid.length?`Recorded this month: ${paid.map(item=>`${item.name} ${money(Number(item.amount||0)-Number(item.adjustment||0))}`).join(' + ')}`:'No utility transactions recorded this month.';
  }
  const api={active,total,upsert,deactivate,migrate,status,actualStatus};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.RecurringUtils=api;
})(globalThis);

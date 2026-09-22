/* Monthly obligations stay independent; payment saves may explicitly update an estimate. */
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
  function paymentPortion(transaction){
    const actual=(transaction.items||[]).reduce((sum,item)=>sum+(['avoided','cancelled','reused'].includes(item.status)?0:Math.round(Number(item.amount||0)*100)-Math.round(Number(item.adjustment||0)*100)),0);
    const oneTime=Number(transaction.oneTimeAmount??0);
    if(!Number.isFinite(actual)||actual<0||!Number.isFinite(oneTime)||oneTime<0||oneTime>actual/100)throw new Error('One-time portion must be between $0 and the actual payment.');
    return {actualAmount:actual/100,oneTimeAmount:Math.round(oneTime*100)/100,recurringAmount:(actual-Math.round(oneTime*100))/100};
  }
  // Explicit save-time side effect. Historical records never continuously drive estimates.
  function saveTransaction(saved,transaction,{updateMonthlyEstimate=false}={},now=new Date().toISOString()){
    const prior=saved.transactions.find(record=>record.id===transaction.id);
    let next={...prior,...transaction,id:transaction.id||crypto.randomUUID()},bills=saved.recurringCharges||[];
    if(next.recurringChargeId){
      const bill=bills.find(record=>record.id===next.recurringChargeId);
      const portion=paymentPortion(next);
      next.oneTimeAmount=portion.oneTimeAmount;
      if(updateMonthlyEstimate){
        if(!bill||bill.active===false)throw new Error('Choose an active monthly bill before updating its estimate.');
        if(bill.kind!=='estimated')throw new Error('Fixed monthly bills must be edited in Monthly bills.');
        if(!next.items?.length||next.items.some(item=>!['utilities','housing_recurring'].includes(item.bucket)||item.status&&item.status!=='kept'))throw new Error('Use a separate housing or utility payment with kept line items to update a monthly estimate.');
        bills=upsert(bills,{...bill,amount:portion.recurringAmount},now);
      }
    }else{
      if(updateMonthlyEstimate)throw new Error('Choose a monthly bill before updating its estimate.');
      delete next.recurringChargeId;delete next.oneTimeAmount;
    }
    return {...saved,recurringCharges:bills,transactions:prior?saved.transactions.map(record=>record.id===next.id?next:record):[...saved.transactions,next]};
  }
  const api={active,total,upsert,deactivate,migrate,status,actualStatus,paymentPortion,saveTransaction};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.RecurringUtils=api;
})(globalThis);

/* Effective-dated recurring reporting; virtual occurrences never mutate ledger data. */
(function(root){
  const Housing=typeof module!=='undefined'&&module.exports?require('./housing-utils.js'):root.HousingUtils;
  const Finance=typeof module!=='undefined'&&module.exports?require('./finance-utils.js'):root.FinanceUtils;
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
    let next={...prior,...transaction,id:transaction.id||crypto.randomUUID()},bills=Housing.currentBills(saved);
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
    return Housing.captureEstimates(saved,{...saved,recurringCharges:(saved.recurringCharges||[]).map(b=>b.id===next.recurringChargeId&&updateMonthlyEstimate?bills.find(x=>x.id===b.id):b),transactions:prior?saved.transactions.map(record=>record.id===next.id?next:record):[...saved.transactions,next]});
  }
  // Identity belongs to the reporting occurrence, not a second transaction record.
  function monthly(saved,month,today=Housing.localMonth()+'-'+String(new Date().getDate()).padStart(2,'0')){
    Housing.month(month);const current=today.slice(0,7),revisions=Housing.data(saved).recurring_charge_revisions;
    const transactions=(saved.transactions||[]).filter(t=>t.date.slice(0,7)===month),automatic=[],occurrences=[];
    for(const bill of saved.recurringCharges||[]){
      const revision=Housing.latest(revisions.filter(r=>r.recurring_charge_id===bill.id),month);
      const linked=transactions.filter(t=>t.recurringChargeId===bill.id);
      // No inferred historical start: a revision is required for automatic recognition.
      if(!revision||!revision.active){if(!linked.length)continue;}
      const amount=revision?revision.amount_cents/100:bill.amount,kind=revision?.kind||bill.kind;
      const start=revision?.effective_date||revision?.effective_month+'-01';
      const eligible=!!revision&&revision.active&&month<=current&&start<=today;
      const isUtility=!!(revision?.utility_type||bill.utilityType)||['Utilities','Internet'].includes(revision?.category||bill.category);
      const bucket=isUtility?'utilities':'housing_recurring';
      const actual=linked.reduce((n,t)=>n+Math.round(Finance.expenses(t.items).expenses*100),0)/100;
      const service=linked.reduce((n,t)=>n+Math.round(paymentPortion(t).recurringAmount*100),0)/100;
      const auto=eligible&&kind==='fixed'&&!linked.length;
      const item={name:bill.name,amount,category:isUtility?'Utilities':'Other',bucket,status:'kept',adjustment:0,setupClass:'none'};
      if(auto)automatic.push(item);
      occurrences.push({key:`recurring:${bill.id}:${month}`,billId:bill.id,name:bill.name,month,kind,bucket,amount,actual,service,linkedIds:linked.map(t=>t.id),automatic:auto,recognized:auto?amount:actual,estimate:kind==='estimated'&&!linked.length&&revision?.active?amount:0,eligible,dueDay:revision?.due_day??null,dueDate:revision?.due_day?month+'-'+String(Math.min(revision.due_day,new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate())).padStart(2,'0'):null,autopay:revision?.autopay??true,start,status:linked.length?'Recorded actual':!eligible?'Projected / not yet recognized':kind==='estimated'?'Awaiting actual amount':revision.autopay===false?'Scheduled':'Scheduled / Autopay'});
    }
    const total=Finance.expenses([...transactions.flatMap(t=>t.items),...automatic]);
    const sum=fn=>occurrences.reduce((n,o)=>n+Math.round(fn(o)*100),0)/100;
    return {occurrences,automatic,totals:total,fixedRecognized:sum(o=>o.automatic?o.amount:0),variableActual:sum(o=>o.kind==='estimated'?o.actual:0),outstanding:sum(o=>o.estimate),projected:sum(o=>o.kind==='estimated'&&o.linkedIds.length?o.service:o.amount)};
  }
  function occurrenceMonths(saved,today){const end=today.slice(0,7),starts=Housing.data(saved).recurring_charge_revisions.map(r=>r.effective_month).sort();if(!starts.length)return [];const out=[];let m=starts[0];while(m<=end){out.push(m);if(out.length>1200)throw Error('Recurring history exceeds supported range');let [y,n]=m.split('-').map(Number);if(++n===13){n=1;y++}m=`${String(y).padStart(4,'0')}-${String(n).padStart(2,'0')}`}return out}
  const api={active,total,upsert,deactivate,migrate,status,actualStatus,paymentPortion,saveTransaction,monthly,occurrenceMonths};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.RecurringUtils=api;
})(globalThis);

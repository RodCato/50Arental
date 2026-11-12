/* Read-only payment analytics. No estimates, virtual occurrences, inference from text, or persistence. */
(function(root){
  const F=typeof module!=='undefined'&&module.exports?require('./finance-utils.js'):root.FinanceUtils;
  const services=['electricity','water'];
  const labels={electricity:'Electricity',water:'Water / sewer'};
  // Exact stored classifications only. Item names and merchants are never consulted.
  const classifications=new Map([['electricity','electricity'],['water','water'],['sewer','water'],['water/sewer','water'],['water / sewer','water'],['internet','internet']]);
  const service=value=>classifications.get(String(value??'').trim().toLowerCase())||null;
  const monthOK=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m)&&Number(m.slice(0,4))>0;
  const dayOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number(d.slice(0,4))>0&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  function shiftMonth(month,delta){let n=Number(month.slice(0,4))*12+Number(month.slice(5,7))-1+delta;return `${String(Math.floor(n/12)).padStart(4,'0')}-${String(n%12+1).padStart(2,'0')}`;}
  const uniqueType=rows=>{const values=new Set(rows.map(r=>{const type=service(r.utilityType??r.utility_type),category=service(r.category);return type&&category&&type!==category?null:type||category;}));return values.size===1?[...values][0]:null;};
  function billType(state,id,month){
    if(!id)return null;
    const bills=(state.recurringCharges||[]).filter(b=>b.id===id);if(!bills.length)return null;
    const revisions=(state.housingFinance?.recurring_charge_revisions||[]).filter(r=>r.recurring_charge_id===id);
    const effective=revisions.filter(r=>r.effective_month<=month),latest=effective.map(r=>r.effective_month).sort().at(-1);
    if(latest)return uniqueType(effective.filter(r=>r.effective_month===latest));
    // Before the first revision, use the explicit bill classification only if
    // the available history does not contradict it. Never backdate a changed type.
    return uniqueType([...bills,...revisions]);
  }
  const activeItem=i=>!['avoided','cancelled','reused'].includes(i.status);
  const baseCandidate=i=>i.bucket==='utilities'||(i.bucket==='housing_one_time'&&i.setupClass==='lease_service_setup'||i.bucket==='refundable_deposit')&&(i.category==='Utilities'||service(i.category));
  const genericComponent=i=>i.category==='Other'&&(i.bucket==='refundable_deposit'||i.bucket==='housing_one_time'&&i.setupClass==='lease_service_setup');
  const expense=i=>i.bucket==='refundable_deposit'?F.depositExpense(i):F.netItem(i);
  const fingerprint=t=>JSON.stringify({date:t.date,recurringChargeId:t.recurringChargeId,items:(t.items||[]).map(i=>Object.fromEntries(['amount','adjustment','bucket','category','status','beneficiary','setupClass','depositStatus','depositRefunded'].map(k=>[k,i[k]])))});
  function history(state,{month,today}){
    if(!monthOK(month)||!dayOK(today))throw Error('Choose a valid payment month.');
    const byMonth=new Map(),issues={duplicatesIgnored:0,conflictingTransactions:0,invalidDates:0,futureTransactions:0},transactions=new Map(),conflicts=new Set();
    for(const t of state.transactions||[]){if(!t.id){issues.conflictingTransactions++;continue;}if(transactions.has(t.id)){if(fingerprint(transactions.get(t.id))===fingerprint(t))issues.duplicatesIgnored++;else conflicts.add(t.id);}else transactions.set(t.id,t);}
    issues.conflictingTransactions+=conflicts.size;
    const entry=m=>{if(!byMonth.has(m))byMonth.set(m,{month:m,electricity:{cents:0,lines:0,ids:new Set()},water:{cents:0,lines:0,ids:new Set()},unclassified:{cents:0,lines:0,reasons:new Set()}});return byMonth.get(m);};
    for(const [id,t] of transactions){
      if(conflicts.has(id))continue;
      if(!dayOK(t.date)){issues.invalidDates++;continue;}if(t.date>today){issues.futureTransactions++;continue;}
      const m=t.date.slice(0,7),linked=billType(state,t.recurringChargeId,m),items=(t.items||[]).filter(activeItem),base=items.filter(baseCandidate);
      const types=new Set([linked,...base.map(i=>service(i.category))].filter(Boolean)),mixed=types.size>1;
      const scopedComponent=i=>genericComponent(i)&&(linked||base.length>0);
      const candidates=items.filter(i=>baseCandidate(i)||scopedComponent(i));
      const unrelated=items.some(i=>!baseCandidate(i)&&!scopedComponent(i)&&i.bucket!=='tax'&&expense(i)!==0);
      for(const i of items){
        if(!F.personal(i))continue;
        const tax=i.bucket==='tax'&&candidates.length>0,component=scopedComponent(i);
        if(!baseCandidate(i)&&!component&&!tax)continue;
        const cents=Math.round(expense(i)*100);if(i.bucket==='refundable_deposit'&&cents===0)continue;
        const explicit=service(i.category);
        // An explicit item category allocates only that line. The bill link may
        // allocate generic utility lines only in a single-service transaction.
        let type=explicit||(!mixed?linked:null);
        if((tax||component)&&(unrelated||mixed))type=null;
        if(type==='internet')continue;
        const e=entry(m);
        if(services.includes(type)){e[type].cents+=cents;e[type].lines++;e[type].ids.add(id);}
        else{e.unclassified.cents+=cents;e.unclassified.lines++;e.unclassified.reasons.add((tax||component)&&(unrelated||mixed)?'Fees, tax or deposit expense cannot be allocated across mixed purchases/services':mixed?'Mixed services: generic lines have no allocation':'No unambiguous stored service classification');}
      }
    }
    const point=(type,m)=>{const e=byMonth.get(m),v=e?.[type];return {month:m,cents:v?.lines?v.cents:null,lines:v?.lines||0,transactions:v?.ids.size||0,unclassifiedLines:e?.unclassified.lines||0};};
    const window=Array.from({length:12},(_,i)=>shiftMonth(month,i-11)).filter(monthOK),knownMonths=[...byMonth.keys()].sort();
    const result={month,currentMonth:today.slice(0,7),window,issues,services:{},unclassified:window.map(m=>{const u=byMonth.get(m)?.unclassified;return {month:m,cents:u?.cents??0,lines:u?.lines??0,reasons:[...(u?.reasons||[])]};})};
    for(const type of services){
      const selected=point(type,month),current=point(type,result.currentMonth);
      const prior=knownMonths.filter(m=>m<month).map(m=>point(type,m)).filter(p=>p.cents!==null&&!p.unclassifiedLines).at(-1)||null;
      const comparable=selected.cents!==null&&!selected.unclassifiedLines&&prior!==null&&!issues.conflictingTransactions&&!issues.invalidDates;
      const difference=comparable?selected.cents-prior.cents:null;
      result.services[type]={selected,current,prior,difference,percent:comparable&&prior.cents>0?difference/prior.cents*100:null,points:window.map(m=>point(type,m))};
    }
    return result;
  }
  const api={services,labels,service,billType,history,shiftMonth};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.UtilityUtils=api;
})(globalThis);

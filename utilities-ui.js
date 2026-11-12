/* Derived display only: no ledger commits, storage reads/writes, or network calls. */
(async()=>{
  const U=UtilityUtils,root=document.querySelector('#utilityPaymentContent');
  const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
  const monthLabel=m=>new Intl.DateTimeFormat('en-US',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01T00:00:00Z'));
  const node=(parent,tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;parent.append(e);return e;};
  const amount=p=>p.cents===null?'No recorded payment':money(p.cents);
  function chart(parent,points,label){
    const chart=node(parent,'div',undefined,'utility-dollar-chart');chart.setAttribute('aria-hidden','true');
    const values=points.filter(p=>p.cents!==null).map(p=>p.cents),min=Math.min(0,...values),max=Math.max(0,...values);
    // Round axis bounds outward to whole dollars; zero stays explicit, including reversals.
    const lo=Math.floor(min/100)*100,hi=Math.max(lo===0?100:0,Math.ceil(max/100)*100),range=hi-lo,zero=-lo/range*100;
    const axis=node(chart,'div',undefined,'utility-dollar-axis');node(axis,'span',money(lo));node(axis,'span',money(hi));
    node(chart,'p','Net dollars ($) · line = $0.00; credits extend left','utility-axis-caption');
    for(const p of points){
      const row=node(chart,'div',undefined,'utility-dollar-row');node(row,'span',monthLabel(p.month),'utility-month-label');
      const track=node(row,'div',undefined,'utility-bar-track'),baseline=node(track,'span',undefined,'utility-zero-line');baseline.style.left=`${zero}%`;
      if(p.cents!==null){const bar=node(track,'span',undefined,`utility-dollar-bar${p.cents<0?' credit':''}${p.unclassifiedLines?' partial':''}`);bar.style.left=`${Math.min(zero,(p.cents-lo)/range*100)}%`;bar.style.width=`${Math.abs(p.cents)/range*100}%`;}
      else node(track,'span','—','utility-no-data');
      node(row,'span',p.cents===null?'No data':money(p.cents),'utility-bar-value');
    }
    const details=node(parent,'details',undefined,'utility-values');node(details,'summary',`${label}: exact monthly values and payment counts`);
    const table=node(details,'table');node(table,'caption',`${label} payment history — counts are payment transactions; missing months are not zero-dollar bills`);
    const head=node(table,'thead'),hr=node(head,'tr');for(const title of ['Month','Net paid','Payments']){const th=node(hr,'th',title);th.scope='col';}
    const body=node(table,'tbody');for(const p of points){const row=node(body,'tr'),th=node(row,'th',monthLabel(p.month));th.scope='row';node(row,'td',p.cents===null?'No data':money(p.cents));node(row,'td',`${p.transactions}${p.unclassifiedLines?' · Unallocated':''}`);}
  }
  function render(state,month,today){
    root.replaceChildren();let report;try{report=U.history(state,{month,today});}catch{node(root,'p','Utility payment history is unavailable. Review the selected month and stored classifications.');return;}
    node(root,'p',`PAYMENT HISTORY · 12 months ending ${monthLabel(month)}. Grouped by transaction posting/payment date, not billing period or consumption.`, 'utility-history-intro');
    node(root,'p','Actual personal-household charges only, net of refunds and including classified one-time fees. Estimates, scheduled bills, internet and Kids/Ex are excluded. Current-month payments may be incomplete.','meta');
    const selectedUnknown=report.unclassified.find(p=>p.month===month),unknown=node(root,'section',undefined,'utility-unclassified');unknown.setAttribute('aria-label','Unclassified utility charges');
    node(unknown,'strong',selectedUnknown.lines?`${monthLabel(month)}: ${money(selectedUnknown.cents)} unclassified (${selectedUnknown.lines} lines)`:`${monthLabel(month)}: no unclassified utility lines`);
    node(unknown,'p','Generic Utilities lines need a stored monthly-bill association and service type. Mixed-service fees or tax without an allocation stay out of service charts. No merchant or item-name guessing.','meta');
    if(selectedUnknown.lines)node(unknown,'p',selectedUnknown.reasons.join('. ')+'. Comparisons are unavailable for this month.');
    const unknownHistory=report.unclassified.filter(p=>p.lines);if(unknownHistory.length){const d=node(unknown,'details');node(d,'summary','Unclassified amounts in this 12-month window');const list=node(d,'ul');for(const p of unknownHistory)node(list,'li',`${monthLabel(p.month)}: ${money(p.cents)} net · ${p.lines} lines · ${p.reasons.join('; ')}`);}
    const warnings=[];if(report.issues.duplicatesIgnored)warnings.push(`${report.issues.duplicatesIgnored} repeated transaction copies counted once`);if(report.issues.conflictingTransactions)warnings.push(`${report.issues.conflictingTransactions} conflicting or unidentified transactions excluded; comparisons disabled`);if(report.issues.invalidDates)warnings.push(`${report.issues.invalidDates} invalid-date records excluded; comparisons disabled`);if(report.issues.futureTransactions)warnings.push(`${report.issues.futureTransactions} future-dated records excluded until posted`);if(warnings.length)node(root,'p',warnings.join('. ')+'.','meta');
    const cards=node(root,'div',undefined,'utility-history-cards');
    for(const type of U.services){const s=report.services[type],card=node(cards,'section',undefined,'utility-history-card');card.dataset.utilityService=type;const heading=node(card,'h3',U.labels[type]);heading.id=`utility-${type}-title`;card.setAttribute('aria-labelledby',heading.id);
      node(card,'p',`${month===report.currentMonth?'Current':'Selected'} payment month · ${monthLabel(month)}`,'meta');const total=node(card,'strong',amount(s.selected),'utility-primary-total');total.dataset.utilityTotal='';
      if(s.selected.unclassifiedLines)node(card,'p',s.selected.cents===null?'Unallocated utility charges exist; no classified payment total.':'Classified amount only; unallocated utility charges may make this incomplete.','meta');
      if(month!==report.currentMonth)node(card,'p',`Current month (${monthLabel(report.currentMonth)}): ${amount(s.current)}${s.current.unclassifiedLines?' · unallocated charges present':''}`,'meta');
      const comparison=node(card,'dl',undefined,'utility-comparison');node(comparison,'dt','Prior comparable recorded month');node(comparison,'dd',s.prior?`${monthLabel(s.prior.month)} · ${money(s.prior.cents)}`:'None recorded');node(comparison,'dt','Dollar change');node(comparison,'dd',s.difference===null?'Not comparable':`${s.difference>0?'+':''}${money(s.difference)}`);node(comparison,'dt','Percentage change');node(comparison,'dd',s.percent===null?s.difference!==null?'Not defined (prior net is zero or a credit)':'Not comparable':`${s.percent>0?'+':''}${s.percent.toFixed(1)}%`);
      node(card,'p','Comparison uses the nearest earlier recorded month with no unallocated utility lines. Missing months are skipped, never treated as $0. Recorded totals may still be partial bills.','meta');
      chart(card,s.points,U.labels[type]);
    }
  }
  window.UtilityAnalytics={render};
  if(!window.LedgerApp)await new Promise(resolve=>window.addEventListener('ledger-ready',resolve,{once:true}));
  render(LedgerApp.get(),document.querySelector('#monthInput').value||localMonthKey(),localDateKey());
})();

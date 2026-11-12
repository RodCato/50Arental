/* Shared by the dashboard and the offline backup validator. */
(function(root){
  const buckets=['housing_recurring','utilities','housing_one_time','groceries','refundable_deposit','excluded','tax','automotive'];
  const categories=['Kitchen','Bathroom','Furniture','Utilities','Internet','Cleaning','Groceries','Security','Other','Automotive'];
  const setupClasses=['move_in_essential','forgotten_essential','post_move_improvement','lease_service_setup','none'];
  const beneficiaries=['personal','kids_ex'];
  const beneficiaryLabels={personal:'Personal household',kids_ex:'Kids/Ex household'};
  const beneficiaryOf=i=>{if(!Object.hasOwn(i,'beneficiary'))return 'personal';if(!beneficiaries.includes(i.beneficiary))throw Error('Invalid item beneficiary');return i.beneficiary;};
  const personal=i=>beneficiaryOf(i)==='personal';
  const statuses=['kept','returned','refunded','reused','cancelled','avoided'];
  const statusLabels={kept:'Kept',returned:'Returned',refunded:'Refunded',reused:'Reused / owned ($0)',cancelled:'Cancelled',avoided:'Avoided / denied'};
  const receiptDefaults=category=>({category:categories.includes(category)?category:'Other',bucket:category==='Automotive'?'automotive':category==='Groceries'?'groceries':['Utilities','Internet'].includes(category)?'utilities':['Kitchen','Bathroom','Furniture','Cleaning','Security'].includes(category)?'housing_one_time':'excluded',setupClass:'none'});
  const netItem=i=>['avoided','cancelled','reused'].includes(i.status)?0:Number(i.amount||0)-Number(i.adjustment||0);
  const depositReturned=i=>Math.min(Number(i.amount||0),Math.max(0,Number(i.depositRefunded||0)));
  const depositExpense=i=>i.depositStatus==='forfeited'?Number(i.amount||0):i.depositStatus==='partially_refunded'?Number(i.amount||0)-depositReturned(i):0;
  function expenses(items){
    const totals={expenses:0,housing_recurring:0,utilities:0,housing_one_time:0,groceries:0,tax:0,automotive:0,other:0,refunds:0,avoided:0};
    for(const i of items){
      if(['avoided','cancelled'].includes(i.status)){totals.avoided+=Number(i.amount||0);continue}
      const net=i.bucket==='refundable_deposit'?depositExpense(i):netItem(i);
      totals.refunds+=Number(i.adjustment||0);
      if(['housing_recurring','utilities','groceries','tax','automotive'].includes(i.bucket))totals[i.bucket]+=net;
      else if(i.bucket==='housing_one_time'||i.bucket==='refundable_deposit'&&net>0)totals.housing_one_time+=net;
      else totals.other+=net;
      totals.expenses+=net;
    }
    // Bucket totals remain all-household expenses. Only the 50A comparison excludes Kids/Ex.
    const housing=items.filter(personal).reduce((n,i)=>n+(['avoided','cancelled'].includes(i.status)?0:['housing_recurring','utilities','housing_one_time'].includes(i.bucket)?netItem(i):i.bucket==='refundable_deposit'?depositExpense(i):0),0);
    return {...totals,housing};
  }
  function beneficiaryReport(transactions,month,beneficiary='kids_ex'){
    if(!beneficiaries.includes(beneficiary))throw Error('Invalid beneficiary');
    let cents=0;const ids=new Set(),categories=new Map();
    for(const t of transactions){if(month&&String(t.date).slice(0,7)!==month)continue;
      for(const i of t.items){if(beneficiaryOf(i)!==beneficiary)continue;
        const net=Math.round(expenses([i]).expenses*100);if(!net)continue;
        ids.add(t.id);cents+=net;categories.set(i.category,(categories.get(i.category)||0)+net);
      }
    }
    return {total:cents/100,transactionCount:ids.size,categories:[...categories].sort(([a],[b])=>a.localeCompare(b)).map(([category,cents])=>({category,total:cents/100}))};
  }
  function assertBeneficiaryReplacement(previous,items){
    if(previous.some(i=>Object.hasOwn(i,'beneficiary'))&&items.some(i=>!Object.hasOwn(i,'beneficiary')))throw Error('Choose a beneficiary for every replacement item, including tax. Existing beneficiary choices cannot be matched automatically to new receipt lines.');
    items.forEach(beneficiaryOf);
  }
  function benchmark(settings,records){
    const recurringRunRate=(records||[]).filter(r=>r.active!==false).reduce((sum,r)=>sum+Math.round(Number(r.amount)*100),0)/100;
    const adjustmentTotal=settings.joshAdjustments.reduce((sum,a)=>sum+Number(a.amount||0),0);
    const benchmark=Number(settings.joshRent||0)+adjustmentTotal/(Math.max(1,Number(settings.joshStayDays||1))/30.4375);
    const monthlySavings=Math.round((benchmark-recurringRunRate)*100)/100;
    return {recurringRunRate,adjustmentTotal,benchmark,monthlySavings,annual:Math.round(monthlySavings*100)*12/100};
  }
  const api={beneficiaries,beneficiaryLabels,beneficiaryOf,personal,beneficiaryReport,assertBeneficiaryReplacement,buckets,categories,setupClasses,statuses,statusLabels,receiptDefaults,netItem,depositReturned,depositExpense,expenses,benchmark};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FinanceUtils=api;
})(globalThis);

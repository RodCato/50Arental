/* Shared by the dashboard and the offline backup validator. */
(function(root){
  const buckets=['housing_recurring','utilities','housing_one_time','groceries','refundable_deposit','excluded'];
  const netItem=i=>['avoided','cancelled','reused'].includes(i.status)?0:Number(i.amount||0)-Number(i.adjustment||0);
  const depositReturned=i=>Math.min(Number(i.amount||0),Math.max(0,Number(i.depositRefunded||0)));
  const depositExpense=i=>i.depositStatus==='forfeited'?Number(i.amount||0):i.depositStatus==='partially_refunded'?Number(i.amount||0)-depositReturned(i):0;
  function expenses(items){
    const totals={expenses:0,housing_recurring:0,utilities:0,housing_one_time:0,groceries:0,other:0,refunds:0,avoided:0};
    for(const i of items){
      if(['avoided','cancelled'].includes(i.status)){totals.avoided+=Number(i.amount||0);continue}
      const net=i.bucket==='refundable_deposit'?depositExpense(i):netItem(i);
      totals.refunds+=Number(i.adjustment||0);
      if(['housing_recurring','utilities','groceries'].includes(i.bucket))totals[i.bucket]+=net;
      else if(i.bucket==='housing_one_time'||i.bucket==='refundable_deposit'&&net>0)totals.housing_one_time+=net;
      else totals.other+=net;
      totals.expenses+=net;
    }
    return {...totals,housing:totals.housing_recurring+totals.utilities+totals.housing_one_time};
  }
  function benchmark(settings,records){
    const recurringRunRate=(records||[]).filter(r=>r.active!==false).reduce((sum,r)=>sum+Math.round(Number(r.amount)*100),0)/100;
    const adjustmentTotal=settings.joshAdjustments.reduce((sum,a)=>sum+Number(a.amount||0),0);
    const benchmark=Number(settings.joshRent||0)+adjustmentTotal/(Math.max(1,Number(settings.joshStayDays||1))/30.4375);
    const monthlySavings=Math.round((benchmark-recurringRunRate)*100)/100;
    return {recurringRunRate,adjustmentTotal,benchmark,monthlySavings,annual:Math.round(monthlySavings*100)*12/100};
  }
  const api={buckets,netItem,depositReturned,depositExpense,expenses,benchmark};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FinanceUtils=api;
})(globalThis);

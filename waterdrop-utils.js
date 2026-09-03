(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WaterdropUtils=factory()})(typeof globalThis==='undefined'?this:globalThis,()=>{
  const DAY=86400000,MIN_HISTORY=DAY;
  function datedEvents(events=[]){return events.filter(event=>event&&typeof event.completedAt==='string'&&!Number.isNaN(new Date(event.completedAt).getTime())).sort((a,b)=>new Date(a.completedAt)-new Date(b.completedAt))}
  function newestCompletion(events=[]){return events.length?events[events.length-1]:null}
  function averageIntervalDays(events=[]){const dated=datedEvents(events);if(dated.length<2)return null;const elapsed=new Date(dated.at(-1).completedAt)-new Date(dated[0].completedAt);if(elapsed<MIN_HISTORY)return null;return elapsed/DAY/(dated.length-1)}
  function pace(events=[]){const interval=averageIntervalDays(events);if(!interval)return null;return interval>=1?{intervalDays:interval,gallonsPerDay:1/interval,gallons30Days:30/interval,label:`Avg. 1 gallon every ${interval.toFixed(1)} days`}:{intervalDays:interval,gallonsPerDay:1/interval,gallons30Days:30/interval,label:`Avg. ${(1/interval).toFixed(1)} gallons/day`}}
  function projectedBreakEvenDate(events=[],gallons=0,target=59){const interval=averageIntervalDays(events),remaining=Math.max(0,target-gallons),latest=datedEvents(events).at(-1);if(!interval||!remaining||!latest)return null;return new Date(new Date(latest.completedAt).getTime()+remaining*interval*DAY)}
  function orderedRecent(events=[],limit=5){return [...events].sort((a,b)=>{const aTime=a?.completedAt?new Date(a.completedAt).getTime():-Infinity,bTime=b?.completedAt?new Date(b.completedAt).getTime():-Infinity;return bTime-aTime}).slice(0,limit)}
  return{datedEvents,newestCompletion,averageIntervalDays,pace,projectedBreakEvenDate,orderedRecent}
});

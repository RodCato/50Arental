/* Housing Coverage: pure source-data calculations, never expense transactions. */
(function(root){
 const fields={
 income_sources:['name','source_type','active','hourly_rate_cents','typical_shift_hundredths'],
 work_sessions:['income_source_id','work_date','hours_hundredths','hourly_rate_cents','notes'],
 paychecks:['income_source_id','pay_date','period_start','period_end','gross_cents','net_cents','notes'],
 financial_goals:['name','goal_type','target_cents','active','completed'],
 coverage_settings:['effective_month','income_source_id','goal_id'],
 recurring_charge_revisions:['recurring_charge_id','effective_month','amount_cents','active','included','kind','category','utility_type']
 };
 const tables=Object.keys(fields),empty=()=>Object.fromEntries(tables.map(t=>[t,[]]));
 const data=s=>({...empty(),...(s.housingFinance||{})});
 const fail=message=>{throw Error(message)};
 const int=(v,max=99999999999)=>{if(!Number.isSafeInteger(v)||v<0||v>max)fail('Invalid non-negative integer amount');return v};
 const money=v=>{const t=String(v);if(!/^\d+(\.\d{1,2})?$/.test(t))fail('Use an amount with at most two decimal places');const [a,b='']=t.split('.');return int(Number(a)*100+Number(b.padEnd(2,'0')))};
 const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d\d-\d\d$/.test(v)||v<'0001-01-01'||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail('Invalid calendar date');return v};
 const month=v=>{if(typeof v!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)||v<'0001-01')fail('Invalid effective month');return v};
 const localMonth=(now=new Date())=>`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
 const latest=(rows,m)=>rows.filter(r=>r.effective_month<=m).sort((a,b)=>b.effective_month.localeCompare(a.effective_month))[0];
 const add=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))fail('Total exceeds safe money range');return n};
 const gross=w=>Math.floor((int(w.hours_hundredths,2400)*int(w.hourly_rate_cents,10000000)+50)/100);
 function validate(s){
  if(s.housingFinance!==undefined&&(!s.housingFinance||typeof s.housingFinance!=='object'||Array.isArray(s.housingFinance)))fail('Invalid Housing Coverage state');const d=data(s);if(s.housingFinance&&Object.keys(s.housingFinance).some(k=>!tables.includes(k)))fail('Unknown Housing Coverage collection');
  const owners=new Set();for(const t of tables){if(!Array.isArray(d[t])||d[t].length>100000)fail('Invalid finance collection');const ids=new Set();for(const r of d[t]){
   if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id))fail('Duplicate or missing finance ID');ids.add(r.id);
   if(Object.keys(r).some(k=>!['id','owner_id','created_at','updated_at',...fields[t]].includes(k)))fail('Unknown finance field');
   if(r.owner_id!==undefined){if(typeof r.owner_id!=='string'||!r.owner_id)fail('Invalid owner');owners.add(r.owner_id)}
   for(const k of ['created_at','updated_at'])if(r[k]!==undefined&&(!/^\d{4}-\d\d-\d\dT/.test(r[k])||!Number.isFinite(Date.parse(r[k]))))fail('Invalid audit timestamp');
   for(const k of ['name','source_type','goal_type','notes','category','utility_type'])if(fields[t].includes(k)&&(typeof r[k]!=='string'||r[k].length>4000||['name','category'].includes(k)&&!r[k].trim()))fail('Invalid finance text');
   for(const k of ['active','completed','included'])if(fields[t].includes(k)&&typeof r[k]!=='boolean')fail('Invalid finance flag');
  }}if(owners.size>1)fail('Mixed finance owners');
  const source=id=>{const r=d.income_sources.find(r=>r.id===id);if(!r)fail('Missing income source');return r};
  for(const r of d.income_sources){if(!['employment','other'].includes(r.source_type))fail('Invalid income source type');if(r.hourly_rate_cents!==null)int(r.hourly_rate_cents,10000000);if(r.typical_shift_hundredths!==null){int(r.typical_shift_hundredths,2400);if(!r.typical_shift_hundredths)fail('Shift length must be positive')}}
  for(const r of d.work_sessions){source(r.income_source_id);date(r.work_date);int(r.hours_hundredths,2400);int(r.hourly_rate_cents,10000000);if(!r.hours_hundredths||!r.hourly_rate_cents)fail('Hours and hourly rate must be positive');gross(r)}
  for(const r of d.paychecks){source(r.income_source_id);date(r.pay_date);int(r.net_cents);if(r.gross_cents!==null)int(r.gross_cents);if((r.period_start===null)!==(r.period_end===null))fail('Enter both pay-period dates');if(r.period_start!==null){date(r.period_start);date(r.period_end);if(r.period_start>r.period_end||Date.parse(r.period_end)-Date.parse(r.period_start)>366*86400000)fail('Invalid pay period');if(d.paychecks.some(p=>p.id!==r.id&&p.income_source_id===r.income_source_id&&p.period_start!==null&&p.period_start<=r.period_end&&p.period_end>=r.period_start))fail('Pay periods for one source cannot overlap')}}
  for(const r of d.financial_goals){int(r.target_cents);if(!['debt','investment','other'].includes(r.goal_type))fail('Invalid goal type')}
  const unique=new Set();for(const r of d.coverage_settings){month(r.effective_month);if(unique.has(r.effective_month))fail('Duplicate coverage configuration month');unique.add(r.effective_month);if(r.income_source_id!==null)source(r.income_source_id);if(r.goal_id!==null&&!d.financial_goals.some(g=>g.id===r.goal_id))fail('Missing financial goal')}
  unique.clear();for(const r of d.recurring_charge_revisions){month(r.effective_month);if(!(s.recurringCharges||[]).some(b=>b.id===r.recurring_charge_id))fail('Missing recurring bill');int(r.amount_cents);if(!['fixed','estimated'].includes(r.kind))fail('Invalid bill classification');const key=r.recurring_charge_id+'|'+r.effective_month;if(unique.has(key))fail('Duplicate bill/effective month');unique.add(key)}
  const automotiveOwners=[...(s.vehicles||[]),...(s.fuelEvents||[])].map(r=>r.ownerId).filter(Boolean);if(owners.size&&automotiveOwners.some(o=>!owners.has(o)))fail('Mixed ledger owners');return true;
 }
 function put(s,t,input){if(!tables.includes(t))fail('Unknown finance collection');const next=structuredClone(s),d=data(next),old=d[t].find(r=>r.id===input.id);const now=new Date().toISOString();const r={...old,...input,id:old?.id||input.id||crypto.randomUUID(),created_at:old?.created_at||now,updated_at:now};d[t]=old?d[t].map(x=>x.id===r.id?r:x):[...d[t],r];next.housingFinance=d;validate(next);return next}
 function revise(s,b,effective,included){month(effective);const d=data(s),old=d.recurring_charge_revisions.find(r=>r.recurring_charge_id===b.id&&r.effective_month===effective);return put(s,'recurring_charge_revisions',{id:old?.id,recurring_charge_id:b.id,effective_month:effective,amount_cents:money(b.amount),active:b.active,included,kind:b.kind,category:b.category,utility_type:b.utilityType||''})}
 function baseline(s,m,choices){month(m);if(data(s).coverage_settings.length)fail('Housing baseline already established');if(choices.length!==s.recurringCharges.length||new Set(choices.map(b=>b.id)).size!==choices.length)fail('Confirm every existing monthly bill');let next=structuredClone(s);for(const c of choices){const bill=s.recurringCharges.find(b=>b.id===c.id);if(!bill)fail('Unknown monthly bill');next=revise(next,{...bill,amount:c.amount,active:c.active},m,c.included)}return put(next,'coverage_settings',{effective_month:m,income_source_id:null,goal_id:null})}
 function billEdit(before,after,id,m,included){month(m);if(!data(before).coverage_settings.length)return after;let next=revise(after,after.recurringCharges.find(b=>b.id===id),m,included);const r=latest(data(next).recurring_charge_revisions.filter(r=>r.recurring_charge_id===id),localMonth());next.recurringCharges=next.recurringCharges.map(b=>b.id===id?{...b,amount:r?r.amount_cents/100:b.amount,active:r?.active??false,kind:r?.kind??b.kind,category:r?.category??b.category,utilityType:r?.utility_type??b.utilityType}:b);return next}
 function captureEstimates(before,after,m=localMonth()){
  if(!data(before).coverage_settings.length)return after;let next=after;for(const b of after.recurringCharges){const old=currentBills(before,m).find(r=>r.id===b.id);if(old&&(old.amount!==b.amount||old.active!==b.active)){const r=latest(data(before).recurring_charge_revisions.filter(r=>r.recurring_charge_id===b.id),m);next=revise(next,b,m,r?.included??false)}}return next;
 }
 function currentBills(s,m=localMonth()){const d=data(s);if(!latest(d.coverage_settings,m))return s.recurringCharges||[];return (s.recurringCharges||[]).map(b=>{const rows=d.recurring_charge_revisions.filter(r=>r.recurring_charge_id===b.id),r=latest(rows,m);return r?{...b,amount:r.amount_cents/100,active:r.active,kind:r.kind,category:r.category,utilityType:r.utility_type}:rows.length?{...b,active:false}:b})}
 function target(s,m){month(m);const d=data(s),config=latest(d.coverage_settings,m);if(!config)return {established:false,cents:null,bills:[],config:null};const bills=(s.recurringCharges||[]).map(b=>latest(d.recurring_charge_revisions.filter(r=>r.recurring_charge_id===b.id),m)).filter(r=>r&&r.active&&r.included);return {established:true,cents:bills.reduce((sum,r)=>add(sum,r.amount_cents),0),bills,config}}
 function earnings(s,sourceId,m){const d=data(s),pays=d.paychecks.filter(p=>p.income_source_id===sourceId),covered=d.work_sessions.filter(w=>w.income_source_id===sourceId&&w.work_date.slice(0,7)===m);let estimated=0,actual=0,superseded=0,hasActual=false;
  for(const w of covered){if(pays.some(p=>p.period_start&&w.work_date>=p.period_start&&w.work_date<=p.period_end))superseded=add(superseded,gross(w));else estimated=add(estimated,gross(w))}
  for(const p of pays.filter(p=>p.period_start)){const start=Date.parse(p.period_start+'T00:00:00Z'),end=Date.parse(p.period_end+'T00:00:00Z'),days=Math.round((end-start)/86400000)+1,q=Math.floor(p.net_cents/days),remainder=p.net_cents%days;for(let i=0;i<days;i++)if(new Date(start+i*86400000).toISOString().slice(0,7)===m){hasActual=true;actual=add(actual,q+(i<remainder?1:0))}}
  return {estimated,actual,superseded,total:add(estimated,actual),unreconciled:pays.filter(p=>!p.period_start).length,label:hasActual&&estimated?'Actual net + estimated gross':hasActual?'Actual net pay':'Estimated gross earnings'};
 }
 function coverage(s,m){const t=target(s,m),d=data(s),source=d.income_sources.find(r=>r.id===t.config?.income_source_id),e=earnings(s,source?.id||null,m);if(!t.established)return {month:m,target:t,source,earnings:e};const covered=Math.min(e.total,t.cents),remaining=Math.max(t.cents-e.total,0),surplus=Math.max(e.total-t.cents,0),goal=d.financial_goals.find(g=>g.id===t.config.goal_id&&g.active&&!g.completed),hours=source?.hourly_rate_cents?remaining/source.hourly_rate_cents:null;
  return {month:m,target:t,source,earnings:e,covered,percent:t.cents?Math.min(100,covered/t.cents*100):0,remaining,surplus,freed:covered,hours,shifts:hours!==null&&source?.typical_shift_hundredths?hours/(source.typical_shift_hundredths/100):null,goal,available:goal?surplus:0};
 }
 function history(s,end=localMonth()){const starts=data(s).coverage_settings.map(r=>r.effective_month).sort();if(!starts.length)return [];const out=[];let m=starts[0];while(m<=end){out.push(coverage(s,m));if(out.length>1200)break;let [y,n]=m.split('-').map(Number);if(++n===13){n=1;y++}m=`${String(y).padStart(4,'0')}-${String(n).padStart(2,'0')}`}return out.reverse()}
 const api={fields,tables,empty,data,validate,money,date,month,localMonth,gross,put,revise,baseline,billEdit,captureEstimates,currentBills,target,earnings,coverage,history,latest};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HousingUtils=api;
})(globalThis);

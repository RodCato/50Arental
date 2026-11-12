/* Optional lease metadata only. Dates are calendar dates; proposed rent never changes bills. */
(function(root){
 const H=typeof module!=='undefined'&&module.exports?require('./housing-utils.js'):root.HousingUtils;
 const empty=()=>({version:1,endDate:null,noticeRule:'unknown',noticeDate:null,noticeDays:null,deliveryRequirements:'',sourceNotes:'',verified:false,verifiedOn:null,rentBillId:null,proposedRentCents:null});
 const fields=Object.keys(empty()),termFields=['endDate','noticeRule','noticeDate','noticeDays','deliveryRequirements','sourceNotes'];
 const day=d=>Date.parse(H.date(d)+'T00:00:00Z')/86400000;
 const shift=(d,n)=>{const result=new Date((day(d)+n)*86400000).toISOString().slice(0,10);H.date(result);return result};
 const rawDeadline=l=>l.noticeRule==='fixed'?l.noticeDate:l.noticeRule==='days'&&l.endDate&&l.noticeDays!==null?shift(l.endDate,-l.noticeDays):null;
 function validateValue(l){
  if(!l||typeof l!=='object'||Array.isArray(l)||Object.keys(l).length!==fields.length||Object.keys(l).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(l,k)))throw Error('Invalid lease metadata fields');
  if(l.version!==1)throw Error('Unsupported lease metadata version');
  for(const k of ['endDate','noticeDate','verifiedOn'])if(l[k]!==null)H.date(l[k]);
  if(!['unknown','fixed','days'].includes(l.noticeRule))throw Error('Invalid lease notice rule');
  if(l.noticeDays!==null&&(!Number.isInteger(l.noticeDays)||l.noticeDays<0||l.noticeDays>3650))throw Error('Notice days must be a whole number from 0 to 3650');
  if(l.noticeRule!=='fixed'&&l.noticeDate!==null||l.noticeRule!=='days'&&l.noticeDays!==null)throw Error('Use only the selected notice rule');
  for(const k of ['sourceNotes','deliveryRequirements'])if(typeof l[k]!=='string'||l[k].length>4000)throw Error('Lease notes must be text of at most 4000 characters');
  if(l.rentBillId!==null&&(typeof l.rentBillId!=='string'||!l.rentBillId.trim()||l.rentBillId.length>200))throw Error('Invalid rent bill reference');
  if(l.proposedRentCents!==null&&(!Number.isSafeInteger(l.proposedRentCents)||l.proposedRentCents<0||l.proposedRentCents>99999999999))throw Error('Invalid proposed monthly housing charge');
  if(typeof l.verified!=='boolean'||(!l.verified&&l.verifiedOn!==null))throw Error('Invalid lease verification');
  const deadline=rawDeadline(l);if(deadline){if(l.endDate&&deadline>l.endDate)throw Error('Notice deadline must not be after lease end');shift(deadline,-45);}
  if(l.verified&&(!l.endDate||!deadline||!l.verifiedOn||!l.sourceNotes.trim()))throw Error('Verify lease end, notice rule/deadline and source reference first');
  return true;
 }
 function validate(state){if(Object.hasOwn(state.settings||{},'leaseTracker'))validateValue(state.settings.leaseTracker);return true;}
 const get=s=>s.settings?.leaseTracker??empty();
 function update(state,input,{verify=false,today}={}){
  const prior=get(state),next={...empty(),...input};
  const same=termFields.every(k=>next[k]===prior[k]);next.verified=verify||same&&prior.verified;next.verifiedOn=verify?H.date(today):next.verified?prior.verifiedOn:null;
  validateValue(next);return {...state,settings:{...state.settings,leaseTracker:next}};
 }
 function currentRent(state,today){
  H.date(today);const l=get(state),all=state.recurringCharges||[];
  const eligible=b=>b.active!==false&&b.kind==='fixed'&&!b.utilityType&&!['Utilities','Internet'].includes(b.category);
  let id=l.rentBillId;if(!id){const exact=all.filter(b=>String(b.name).trim().toLowerCase()==='rent');if(exact.length===1)id=exact[0].id;}
  if(!id)return {cents:null,id:null,reason:'Select the housing-charge monthly bill; no unique Rent bill is identified.'};
  const revisions=H.data(state).recurring_charge_revisions,history=revisions.filter(r=>r.recurring_charge_id===id),effective=history.filter(r=>(r.effective_date||r.effective_month+'-01')<=today);
  if(history.length&&!effective.length)return {cents:null,id,reason:'No rent revision is effective on this date.'};
  const filtered={...state,housingFinance:{...H.data(state),recurring_charge_revisions:revisions.filter(r=>(r.effective_date||r.effective_month+'-01')<=today)}};
  const b=H.currentBills(filtered,today.slice(0,7)).find(b=>b.id===id);
  if(!b||!eligible(b))return {cents:null,id,reason:'Selected bill is missing, inactive, variable, or a utility. Select a fixed housing-charge bill.'};
  return {cents:H.money(b.amount),id,name:b.name,reason:l.rentBillId?'User-selected housing-charge bill.':'Unique bill named Rent; compare an all-in proposal including the same applicable fees.'};
 }
 function status(state,today){
  H.date(today);validate(state);const l=get(state),rent=currentRent(state,today),proposal=l.proposedRentCents,monthly=proposal!==null&&rent.cents!==null?proposal-rent.cents:null;
  const result={terms:l,rent,proposal,monthly,annual:monthly===null?null:monthly*12,percent:monthly!==null&&rent.cents>0?monthly/rent.cents*100:null,deadline:null,reminderStart:null,daysRemaining:null,endDays:null,phase:'unverified',alert:false};
  if(!l.verified)return result;
  result.deadline=rawDeadline(l);result.reminderStart=shift(result.deadline,-45);result.daysRemaining=day(result.deadline)-day(today);result.endDays=day(l.endDate)-day(today);
  result.phase=result.endDays<0?'expired':result.daysRemaining<0?'overdue':result.daysRemaining===0?'due':today>=result.reminderStart?'approaching':'verified';result.alert=today>=result.reminderStart;return result;
 }
 function assertLegacy(state){if(Object.hasOwn(state.settings||{},'leaseTracker'))throw Error('Legacy Google sync cannot preserve lease metadata. Use cloud sync or Portable Backup v3.');}
 const api={empty,fields,termFields,day,shift,validateValue,validate,get,update,currentRent,status,assertLegacy};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LeaseUtils=api;
})(globalThis);

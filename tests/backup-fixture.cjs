const stamp='2026-09-01T12:00:00.000Z';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(){
  const item=(name,amount,bucket,extra={})=>({name,amount:String(amount),category:'Other',bucket,setupClass:'none',status:'kept',adjustment:'0',depositStatus:'held',depositRefunded:0,moveIn:false,prorated:false,...extra});
  const tx=(id,items,extra={})=>({id,date:'2026-09-01',merchant:'Synthetic only',notes:'PRIVATE_TEST_NOTE',receipt:null,attachmentIds:[],items,...extra});
  const state={budget:400,datasetVersion:1,legacyDemoCleanupVersion:2,legacyDemoCleanupRemoved:3,recurringChargesVersion:1,settings:{rent50a:965,joshRent:1450,joshAdjustments:[{label:'Cleaning',amount:250},{label:'Move-out',amount:468}],joshStayDays:68,moveInDate:'2026-08-21',proratedRent:321.6,adminFee:150,depositAmount:800,depositStatus:'held',depositRefunded:0,forgottenEssentialsBudget:100,waterdropPayback:{name:'Waterdrop',gallonsLogged:2,completedDates:['2026-09-01'],waterdropCompletions:[{id:'w1',completedAt:stamp,gallon:1,legacy:false},{id:'w2',completedAt:null,gallon:2,legacy:true}],baselineCostPerGallon:1.25,systemCost:73.35,breakEvenGallon:59},googleSync:{clientId:'PRIVATE_CLIENT_ID',accountEmail:'private@example.test',status:'synced'}},transactions:[tx('electric-tx',[item('Electricity',123,'utilities')],{recurringChargeId:'electric',oneTimeAmount:30,attachmentIds:['receipt','receipt'],_sync:{createdAt:stamp,updatedAt:stamp}}),tx('mixed',[item('Food',20,'groceries'),item('TV',40,'housing_one_time',{setupClass:'move_in_essential',adjustment:'10',giftCardOffset:5}),item('Deposit',100,'refundable_deposit',{depositStatus:'partially_refunded',depositRefunded:25}),item('Excluded',5,'excluded'),item('Avoided',9,'excluded',{status:'avoided'}),item('Reused',9,'excluded',{status:'reused'})])],recurringCharges:[['rent',965,'fixed',true],['electric',93,'estimated',true],['internet',40,'fixed',true],['insurance',21,'fixed',true],['inactive',10,'estimated',false]].map(([id,amount,kind,active])=>({id,name:id,amount,kind,active,category:'Housing',utilityType:id==='electric'?'electricity':'',createdAt:stamp,updatedAt:stamp})),condition:[{id:'condition',room:'Kitchen',phase:'move-in',date:'2026-09-01',notes:'PRIVATE_PROPERTY_NOTE',attachmentId:'property'}],syncMeta:{deviceId:'PRIVATE_DEVICE',pending:true,tombstones:[{id:'old',updatedAt:stamp}]}};
  const records=['receipt','property'].map(id=>({id,transactionId:id==='receipt'?'electric-tx':'condition:condition',kind:id==='receipt'?'receipt':'condition',fileName:id+'.png',mimeType:'image/png',createdAt:stamp,blob:new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})}));
  return {state,records,get:id=>records.find(r=>r.id===id)};
}
module.exports={fixture,png,stamp};
// Matches the inspected real representation, with synthetic identities and no private text.
module.exports.historicalNumericFixture=()=>{
  const f=fixture(),t=f.state.transactions[0];
  t.items[0]={name:'Synthetic utility service',amount:'123',adjustment:'',category:'Utilities',bucket:'utilities',status:'kept',depositStatus:'held',depositRefunded:0};
  delete t.recurringChargeId;delete t.oneTimeAmount;
  f.state.transactions=[f.state.transactions[1],...Array.from({length:4},(_,i)=>({id:`synthetic-zero-${i}`,date:'2026-09-01',merchant:'Synthetic only',notes:'',receipt:null,attachmentIds:[],items:[{name:'Synthetic zero',amount:'0',adjustment:'0',category:'Other',bucket:'excluded',status:'kept'}]})),t];
  return f;
};

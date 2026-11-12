export const utilityItem=(amount,extra={})=>({name:'Synthetic item',amount:String(amount),adjustment:'0',category:'Utilities',bucket:'utilities',status:'kept',setupClass:'none',...extra});
export const utilityPayment=(id,date,items,bill,extra={})=>({id,date,merchant:'Synthetic payment',notes:'',receipt:null,attachmentIds:[],items,...(bill?{recurringChargeId:bill,oneTimeAmount:0}:{}),...extra});
export function utilityFixture(){
 const stamp='2026-09-01T12:00:00.000Z',bills=[['electric','electricity','estimated'],['water','water','fixed'],['internet','internet','fixed']].map(([id,utilityType,kind])=>({id,name:'Synthetic bill',amount:999,category:'Utilities',utilityType,kind,active:true,createdAt:stamp,updatedAt:stamp}));
 return {recurringCharges:bills,housingFinance:{},transactions:[
  utilityPayment('e-aug','2026-08-10',[utilityItem(80)],'electric'),
  utilityPayment('e-sep','2026-09-10',[utilityItem(123)],'electric',{oneTimeAmount:30}),
  utilityPayment('e-extra','2026-09-11',[utilityItem(10)],'electric'),
  utilityPayment('e-credit','2026-10-10',[utilityItem(10,{category:'Electricity',adjustment:'30',status:'refunded'})]),
  utilityPayment('e-nov','2026-11-10',[utilityItem(75),utilityItem(6,{bucket:'housing_one_time',setupClass:'lease_service_setup'}),utilityItem(8,{category:'Groceries',bucket:'groceries'})],'electric',{oneTimeAmount:6}),
  utilityPayment('w-sep','2026-09-12',[utilityItem(40)],'water'),
  utilityPayment('w-nov','2026-11-09',[utilityItem(60,{adjustment:'10'})],'water'),
  utilityPayment('kids','2026-11-09',[utilityItem(200,{beneficiary:'kids_ex'})],'electric'),
  utilityPayment('internet','2026-11-09',[utilityItem(40)],'internet'),
  utilityPayment('unknown','2026-11-09',[utilityItem(7,{name:'Electricity water payment'})],null,{merchant:'Electricity provider'}),
  utilityPayment('mixed','2026-11-09',[utilityItem(2,{category:'Electricity'}),utilityItem(3,{category:'Water / sewer'}),utilityItem(9)])
 ]};
}

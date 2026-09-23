/* Pure portable format. No DOM, network, application startup or storage access. */
(function(root){
  const Finance=typeof module!=='undefined'&&module.exports?require('./finance-utils.js'):root.FinanceUtils;
  const FORMAT='50a-ledger-backup',VERSION=3,MAX_BYTES=128*1024*1024,MAX_IMAGE=20*1024*1024;
  // JSON would silently turn NaN/Infinity into null, which is a legacy zero only in specific fields.
  const clone=value=>JSON.parse(JSON.stringify(value,(_key,v)=>{if(typeof v==='number'&&!Number.isFinite(v))fail('$','nonfinite number');return v}));
  function fail(path,code){throw new Error(`${path}: ${code}`)}
  const object=(v,p)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(p,'expected object');return v};
  const array=(v,p)=>{if(!Array.isArray(v)||v.length>100000)fail(p,'expected bounded array');return v};
  const text=(v,p,nonempty=false)=>{if(typeof v!=='string'||v.length>1000000||nonempty&&!v.trim())fail(p,'invalid text');return v};
  const finiteNumber=(v,p)=>{if(typeof v!=='number'||!Number.isFinite(v))fail(p,'invalid number');return v};
  // Base-ten decimal syntax, including exponent notation accepted by number inputs.
  // Reject whitespace, hex/binary, booleans, arrays and coercion of arbitrary text.
  const decimalNumber=(v,p)=>{if(typeof v==='string'){if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v))fail(p,'invalid number');return finiteNumber(Number(v),p)}return finiteNumber(v,p)};
  const number=(v,p,{positive=false,integer=false}={})=>{const n=decimalNumber(v,p);if(n<0||positive&&n<=0||integer&&!Number.isInteger(n))fail(p,'invalid number');return n};
  // Only optional adjustment/refund/one-time fields have this historical zero meaning.
  // Validate semantically; never replace the original representation in the snapshot.
  const optionalZero=(v,p)=>v===''||v===null||v===undefined?0:number(v,p);
  const enumeration=(v,values,p)=>{if(!values.includes(v))fail(p,'unsupported value')};
  const boolean=(v,p)=>{if(typeof v!=='boolean')fail(p,'expected boolean')};
  function date(v,p){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail(p,'invalid calendar date')}
  function instant(v,p){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))fail(p,'invalid timestamp');date(v.slice(0,10),p)}
  function canonical(value){
    if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
    if(typeof value==='number'){if(!Number.isFinite(value))fail('$','nonfinite value');return JSON.stringify(value)}
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    object(value,'$');return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  }
  async function sha256(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')}
  function safeTree(value,path='$',depth=0){
    if(depth>40)fail(path,'nesting limit');
    if(typeof value==='string'&&/(?:sb_secret_[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/|ya29\.[A-Za-z0-9._-]+|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i.test(value))fail(path,'credential-like content prohibited');
    if(value&&typeof value==='object')for(const key of Object.keys(value)){
      if(['__proto__','prototype','constructor'].includes(key)||/(?:access.?token|refresh.?token|service.?role|password|secret.?key|authorization)/i.test(key))fail(path,'prohibited property');
      safeTree(value[key],`${path}.${/^[A-Za-z0-9_]+$/.test(key)?key:'[property]'}`,depth+1);
    }
  }
  function keys(value,allowed,p){object(value,p);for(const k of Object.keys(value))if(!allowed.includes(k))fail(p,'unsupported field')}
  const txFields=['id','date','merchant','notes','items','receipt','attachmentIds','recurringChargeId','oneTimeAmount','systemKey','sampleKey'];
  const itemFields=['name','amount','category','bucket','setupClass','status','adjustment','depositStatus','depositRefunded','moveIn','prorated','estimated','recurring','giftCardOffset'];
  const settingsFields=['rent50a','joshRent','joshAdjustments','joshStayDays','joshCleaning','moveInDate','proratedRent','adminFee','depositAmount','depositStatus','depositRefunded','forgottenEssentialsBudget','waterdropPayback'];
  const billFields=['id','name','amount','category','kind','utilityType','active','createdAt','updatedAt'];
  const conditionFields=['id','room','phase','date','notes','attachmentId'];
  const stateFields=['portableSchemaVersion','budget','settings','transactions','condition','recurringCharges','recurringChargesVersion','datasetVersion','legacyDemoCleanupVersion','legacyDemoCleanupRemoved'];
  function portableState(input){
    const s=clone(input);delete s.syncMeta;delete s.attachmentGeneration;delete s.backupProvenance;
    if(s.settings)delete s.settings.googleSync;
    for(const collection of [s.transactions,s.condition])if(Array.isArray(collection))for(const r of collection)delete r._sync;
    s.portableSchemaVersion=3;return s;
  }
  function ids(records,path){const set=new Set();records.forEach((r,i)=>{object(r,`${path}[${i}]`);text(r.id,`${path}[${i}].id`,true);if(set.has(r.id))fail(`${path}[${i}].id`,'duplicate ID');set.add(r.id)});return set}
  function receiptType(v){if(v==null||v==='')return 'none';if(typeof v!=='string')return 'invalid';if(v.startsWith('data:'))return 'embedded';if(v.startsWith('blob:'))return 'blob URL';if(/^https?:\/\//i.test(v))return 'remote URL';if(/^(?:\.?\.?\/)/.test(v))return 'relative path';return 'invalid'}
  function references(s){
    const refs=new Map();let count=0;
    const add=(id,parentType,parentId,path)=>{text(id,path,true);count++;const prior=refs.get(id);if(prior&&(prior.parentType!==parentType||prior.parentId!==parentId))fail(path,'attachment has conflicting parents');refs.set(id,{id,parentType,parentId})};
    s.transactions.forEach((t,i)=>{t.attachmentIds.forEach((id,j)=>add(id,'transaction',t.id,`$.state.transactions[${i}].attachmentIds[${j}]`));const type=receiptType(t.receipt);if(type!=='none'&&type!=='embedded')fail(`$.state.transactions[${i}].receipt`,'nonportable evidence');});
    s.condition.forEach((r,i)=>{if(r.attachmentId!=null)add(r.attachmentId,'condition',r.id,`$.state.condition[${i}].attachmentId`)});
    return {refs,count};
  }
  function validateState(s){
    keys(s,stateFields,'$.state');if(s.portableSchemaVersion!==3)fail('$.state.portableSchemaVersion','unsupported schema');
    number(s.budget,'$.state.budget');
    for(const k of ['datasetVersion','legacyDemoCleanupVersion','recurringChargesVersion'])number(s[k],`$.state.${k}`,{integer:true});
    if(s.recurringChargesVersion!==1||s.datasetVersion!==1)fail('$.state','unsupported dataset schema');
    if(s.legacyDemoCleanupRemoved!==undefined)number(s.legacyDemoCleanupRemoved,'$.state.legacyDemoCleanupRemoved',{integer:true});
    const st=s.settings;keys(st,settingsFields,'$.state.settings');
    for(const k of ['rent50a','joshRent','proratedRent','adminFee','depositAmount','depositRefunded','forgottenEssentialsBudget'])number(st[k],`$.state.settings.${k}`);
    if(st.joshCleaning!==undefined)number(st.joshCleaning,'$.state.settings.joshCleaning');
    number(st.joshStayDays,'$.state.settings.joshStayDays',{positive:true,integer:true});date(st.moveInDate,'$.state.settings.moveInDate');
    const deposits=['held','refunded','partially_refunded','forfeited'];enumeration(st.depositStatus,deposits,'$.state.settings.depositStatus');if(Number(st.depositRefunded)>Number(st.depositAmount))fail('$.state.settings.depositRefunded','exceeds deposit');
    array(st.joshAdjustments,'$.state.settings.joshAdjustments').forEach((a,i)=>{const p=`$.state.settings.joshAdjustments[${i}]`;keys(a,['label','amount'],p);text(a.label,p+'.label');number(a.amount,p+'.amount')});
    const w=st.waterdropPayback,pw='$.state.settings.waterdropPayback';keys(w,['name','gallonsLogged','completedDates','waterdropCompletions','baselineCostPerGallon','systemCost','breakEvenGallon'],pw);
    text(w.name,pw+'.name',true);for(const k of ['gallonsLogged','baselineCostPerGallon','systemCost'])number(w[k],pw+'.'+k);number(w.breakEvenGallon,pw+'.breakEvenGallon',{positive:true,integer:true});
    array(w.completedDates,pw+'.completedDates').forEach((d,i)=>date(d,`${pw}.completedDates[${i}]`));
    const events=array(w.waterdropCompletions,pw+'.waterdropCompletions');ids(events,pw+'.waterdropCompletions');
    events.forEach((e,i)=>{const p=`${pw}.waterdropCompletions[${i}]`;keys(e,['id','completedAt','gallon','legacy'],p);boolean(e.legacy,p+'.legacy');if(e.gallon!==i+1)fail(p+'.gallon','invalid ordinal');if(e.completedAt===null){if(!e.legacy)fail(p+'.completedAt','undated event must be legacy')}else if(/^\d{4}-\d\d-\d\d$/.test(e.completedAt))date(e.completedAt,p+'.completedAt');else instant(e.completedAt,p+'.completedAt')});
    if(Number(w.gallonsLogged)!==events.length)fail(pw+'.gallonsLogged','event count mismatch');
    const bills=array(s.recurringCharges,'$.state.recurringCharges'),billIds=ids(bills,'$.state.recurringCharges');
    bills.forEach((b,i)=>{const p=`$.state.recurringCharges[${i}]`;keys(b,billFields,p);for(const k of ['name','category'])text(b[k],p+'.'+k,true);text(b.utilityType,p+'.utilityType');number(b.amount,p+'.amount');enumeration(b.kind,['fixed','estimated'],p+'.kind');boolean(b.active,p+'.active');instant(b.createdAt,p+'.createdAt');instant(b.updatedAt,p+'.updatedAt')});
    const txs=array(s.transactions,'$.state.transactions');ids(txs,'$.state.transactions');
    for(const field of ['sampleKey','systemKey']){const seen=new Set();txs.forEach((t,i)=>{if(t[field]!=null){text(t[field],`$.state.transactions[${i}].${field}`,true);if(seen.has(t[field]))fail(`$.state.transactions[${i}].${field}`,'duplicate key');seen.add(t[field])}})}
    txs.forEach((t,i)=>{const p=`$.state.transactions[${i}]`;keys(t,txFields,p);text(t.merchant,p+'.merchant',true);text(t.notes,p+'.notes');date(t.date,p+'.date');array(t.attachmentIds,p+'.attachmentIds');
      array(t.items,p+'.items').forEach((it,j)=>{const q=`${p}.items[${j}]`;keys(it,itemFields,q);text(it.name,q+'.name',true);text(it.category,q+'.category');number(it.amount,q+'.amount');optionalZero(it.adjustment,q+'.adjustment');enumeration(it.bucket,Finance.buckets,q+'.bucket');enumeration(it.status,['kept','returned','refunded','reused','cancelled','avoided'],q+'.status');if(it.setupClass!==undefined)enumeration(it.setupClass,['none','move_in_essential','forgotten_essential','post_move_improvement','lease_service_setup'],q+'.setupClass');if(it.depositStatus!==undefined)enumeration(it.depositStatus,deposits,q+'.depositStatus');if(it.bucket==='refundable_deposit'&&it.depositStatus===undefined)fail(q+'.depositStatus','required');if(it.depositRefunded!==undefined){const refunded=optionalZero(it.depositRefunded,q+'.depositRefunded');if(refunded>Number(it.amount))fail(q+'.depositRefunded','exceeds deposit')}for(const k of ['moveIn','prorated','estimated','recurring'])if(it[k]!==undefined)boolean(it[k],q+'.'+k);if(it.giftCardOffset!==undefined)number(it.giftCardOffset,q+'.giftCardOffset')});
      if(t.recurringChargeId!=null){if(!billIds.has(t.recurringChargeId))fail(p+'.recurringChargeId','dangling reference');const oneTime=optionalZero(t.oneTimeAmount,p+'.oneTimeAmount');const actual=t.items.reduce((sum,it)=>sum+(['avoided','cancelled','reused'].includes(it.status)?0:Math.round(Number(it.amount)*100)-Math.round(optionalZero(it.adjustment,p+'.items.adjustment')*100)),0)/100;if(oneTime>actual)fail(p+'.oneTimeAmount','exceeds payment')}else if(t.oneTimeAmount!==undefined){if(optionalZero(t.oneTimeAmount,p+'.oneTimeAmount')!==0)fail(p+'.oneTimeAmount','requires associated bill');}
    });
    const conditions=array(s.condition,'$.state.condition');ids(conditions,'$.state.condition');conditions.forEach((r,i)=>{const p=`$.state.condition[${i}]`;keys(r,conditionFields,p);text(r.room,p+'.room');text(r.notes,p+'.notes');enumeration(r.phase,['move-in','move-out'],p+'.phase');date(r.date,p+'.date')});
    return references(s);
  }
  function decode(data,path){
    if(typeof data!=='string'||data.length>MAX_IMAGE*1.4)fail(path,'invalid or oversized data URL');
    const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(data);
    if(!match||!match[2]||match[2].length%4!==0)fail(path,'invalid image base64');
    let raw;try{raw=atob(match[2])}catch{fail(path,'invalid base64')}
    if(btoa(raw)!==match[2])fail(path,'noncanonical base64');
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),mime=match[1];if(bytes.length>MAX_IMAGE)fail(path,'image too large');
    const ascii=(a,b)=>String.fromCharCode(...bytes.slice(a,b));
    const valid=mime==='image/png'?bytes.length>=24&&bytes.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i])&&ascii(12,16)==='IHDR':mime==='image/jpeg'?bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217:bytes.length>=16&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
    if(!valid)fail(path,'MIME/magic mismatch');return {bytes,mime};
  }
  function dataURL(bytes,mime){let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.slice(i,i+8192));return `data:${mime};base64,${btoa(raw)}`}
  const header=b=>({format:b.format,version:b.version,exportedAt:b.exportedAt,application:b.application,provenance:b.provenance,manifest:b.manifest,stateSha256:b.integrity.stateSha256});
  function summary(b,refInfo){const s=b.state;return {transactions:s.transactions.length,lineItems:s.transactions.reduce((n,t)=>n+t.items.length,0),recurringBills:s.recurringCharges.length,activeBills:s.recurringCharges.filter(b=>b.active).length,inactiveBills:s.recurringCharges.filter(b=>!b.active).length,propertyRecords:s.condition.length,waterEvents:s.settings.waterdropPayback.waterdropCompletions.length,attachmentReferences:refInfo.count,uniqueAttachmentReferences:refInfo.refs.size,embeddedAttachments:b.attachments.length,inlineEvidence:s.transactions.filter(t=>receiptType(t.receipt)==='embedded').length,missingAttachments:0,duplicateIds:0,danglingRecurringReferences:0,danglingAttachmentReferences:0,actualExpenses:Finance.expenses(s.transactions.flatMap(t=>t.items)).expenses,months:Object.fromEntries([...new Set(s.transactions.map(t=>t.date.slice(0,7)))].sort().map(m=>[m,Finance.expenses(s.transactions.filter(t=>t.date.startsWith(m)).flatMap(t=>t.items))])),...Finance.benchmark(s.settings,s.recurringCharges)}}
  async function validate(b){
    safeTree(b);if(new TextEncoder().encode(JSON.stringify(b)).byteLength>MAX_BYTES)fail('$','file exceeds 128 MiB limit');keys(b,['format','version','exportedAt','application','provenance','state','attachments','manifest','integrity'],'$');
    if(b.format!==FORMAT)fail('$.format','unsupported format');if(b.version!==VERSION)fail('$.version','unsupported version (legacy v2 requires explicit conversion)');instant(b.exportedAt,'$.exportedAt');
    keys(b.application,['name','schemaVersion'],'$.application');if(b.application.name!=='50A Ledger'||b.application.schemaVersion!==3)fail('$.application','unsupported schema');
    keys(b.provenance,['sourceVersion','recordTimestamps','tombstones'],'$.provenance');enumeration(b.provenance.sourceVersion,[2,3],'$.provenance.sourceVersion');
    array(b.provenance.recordTimestamps,'$.provenance.recordTimestamps').forEach((r,i)=>{const p=`$.provenance.recordTimestamps[${i}]`;keys(r,['collection','id','createdAt','updatedAt'],p);enumeration(r.collection,['transactions','condition'],p+'.collection');text(r.id,p+'.id',true);instant(r.createdAt,p+'.createdAt');instant(r.updatedAt,p+'.updatedAt')});
    array(b.provenance.tombstones,'$.provenance.tombstones').forEach((r,i)=>{const p=`$.provenance.tombstones[${i}]`;keys(r,['id','updatedAt'],p);text(r.id,p+'.id',true);instant(r.updatedAt,p+'.updatedAt')});
    const refs=validateState(b.state);array(b.attachments,'$.attachments');ids(b.attachments,'$.attachments');
    keys(b.manifest,['attachmentCount','attachments','inlineEvidence'],'$.manifest');array(b.manifest.attachments,'$.manifest.attachments');array(b.manifest.inlineEvidence,'$.manifest.inlineEvidence');
    keys(b.integrity,['stateSha256','manifestSha256'],'$.integrity');
    if(await sha256(canonical(b.state))!==b.integrity.stateSha256)fail('$.integrity.stateSha256','hash mismatch');
    if(await sha256(canonical(header(b)))!==b.integrity.manifestSha256)fail('$.integrity.manifestSha256','hash mismatch');
    if(b.manifest.attachmentCount!==b.attachments.length||b.attachments.length!==refs.refs.size||b.manifest.attachments.length!==b.attachments.length)fail('$.attachments','attachment completeness mismatch');
    const decoded=new Map();
    for(let i=0;i<b.attachments.length;i++){
      const a=b.attachments[i],p=`$.attachments[${i}]`;keys(a,['id','parentType','parentId','fileName','mimeType','createdAt','size','sha256','data'],p);
      const ref=refs.refs.get(a.id);if(!ref||ref.parentType!==a.parentType||ref.parentId!==a.parentId)fail(p,'dangling/conflicting attachment parent');
      text(a.fileName,p+'.fileName',true);instant(a.createdAt,p+'.createdAt');
      const {bytes,mime}=decode(a.data,p+'.data');if(a.mimeType!==mime)fail(p+'.mimeType','MIME mismatch');if(a.size!==bytes.length)fail(p+'.size','byte size mismatch');if(a.sha256!==await sha256(bytes))fail(p+'.sha256','hash mismatch');
      const {data,...metadata}=a;if(canonical(metadata)!==canonical(b.manifest.attachments[i]))fail(`$.manifest.attachments[${i}]`,'metadata mismatch');decoded.set(a.id,bytes);
    }
    const inline=[];for(let i=0;i<b.state.transactions.length;i++){const t=b.state.transactions[i];if(receiptType(t.receipt)==='embedded'){const {bytes,mime}=decode(t.receipt,`$.state.transactions[${i}].receipt`);inline.push({transactionId:t.id,mimeType:mime,size:bytes.length,sha256:await sha256(bytes)})}}
    if(canonical(inline)!==canonical(b.manifest.inlineEvidence))fail('$.manifest.inlineEvidence','inline evidence mismatch');
    return {backup:b,decoded,summary:summary(b,refs),restoreEquivalent:canonical(portableState(runtimeState(b,'preflight')))===canonical(b.state)};
  }
  function provenance(input,sourceVersion){return input.backupProvenance?clone(input.backupProvenance):{sourceVersion,recordTimestamps:['transactions','condition'].flatMap(collection=>(input[collection]||[]).filter(r=>r._sync).map(r=>({collection,id:r.id,createdAt:r._sync.createdAt,updatedAt:r._sync.updatedAt}))),tombstones:(input.syncMeta?.tombstones||[]).map(t=>({id:t.id,updatedAt:t.updatedAt||t._sync?.updatedAt}))}}
  async function create(input,getAttachment,{sourceVersion=3,exportedAt=new Date().toISOString()}={}){
    // Clone synchronously BEFORE the first await; reads and output use this snapshot only.
    const snapshot=clone(input),state=portableState(snapshot),source=provenance(snapshot,sourceVersion);
    safeTree(state);const refInfo=validateState(state),attachments=[],missing=[];
    for(const ref of refInfo.refs.values()){
      const record=await getAttachment(ref.id);if(!record?.blob){missing.push(ref.id);continue}
      if(record.blob.size>MAX_IMAGE)fail('$.attachments','image too large');const bytes=new Uint8Array(await record.blob.arrayBuffer()),mime=record.blob.type;
      const expected=ref.parentType==='condition'?`condition:${ref.parentId}`:ref.parentId;
      if(record.id!==ref.id||record.transactionId!==expected)fail('$.attachments','stored attachment parent mismatch');
      if(record.mimeType&&record.mimeType!==mime)fail('$.attachments','stored MIME mismatch');
      attachments.push({...ref,fileName:record.fileName,mimeType:mime,createdAt:record.createdAt,size:bytes.length,sha256:await sha256(bytes),data:dataURL(bytes,mime)});
    }
    if(missing.length)fail('$.attachments',`${missing.length} referenced attachments are missing`);
    const inlineEvidence=[];for(let i=0;i<state.transactions.length;i++){const t=state.transactions[i];if(receiptType(t.receipt)==='embedded'){const {bytes,mime}=decode(t.receipt,`$.state.transactions[${i}].receipt`);inlineEvidence.push({transactionId:t.id,mimeType:mime,size:bytes.length,sha256:await sha256(bytes)})}}
    const b={format:FORMAT,version:3,exportedAt,application:{name:'50A Ledger',schemaVersion:3},provenance:source,state,attachments,manifest:{attachmentCount:attachments.length,attachments:attachments.map(({data,...a})=>a),inlineEvidence},integrity:{stateSha256:await sha256(canonical(state))}};
    b.integrity.manifestSha256=await sha256(canonical(header(b)));await validate(b);return b;
  }
  function runtimeState(b,generation){return {...clone(b.state),attachmentGeneration:generation,backupProvenance:clone(b.provenance),settings:{...clone(b.state.settings),googleSync:{clientId:'',status:'not_connected',lastSuccessAt:null,lastError:null,accountEmail:null,conflictCount:0}}}}
  // Deliberately no historical Josh/name/date/lease rewrites. Only fill legacy omissions.
  async function convertV2(payload,defaults){
    if(payload?.format!==FORMAT||payload.version!==2)fail('$.version','only explicit legacy v2 supported');safeTree(payload);
    const s=clone(payload.state);object(s,'$.state');array(s.transactions,'$.state.transactions');array(s.condition,'$.state.condition');array(s.recurringCharges,'$.state.recurringCharges');object(s.settings,'$.state.settings');
    s.settings={...clone(defaults),...s.settings,waterdropPayback:{...clone(defaults.waterdropPayback),...s.settings.waterdropPayback}};
    const w=s.settings.waterdropPayback;w.completedDates??=[];w.waterdropCompletions??=[];
    if(!w.waterdropCompletions.length&&Number.isInteger(w.gallonsLogged)&&w.gallonsLogged>=0&&w.gallonsLogged<=100000)w.waterdropCompletions=Array.from({length:w.gallonsLogged},(_,i)=>({id:`waterdrop-legacy-${i+1}`,completedAt:w.completedDates[i]||null,gallon:i+1,legacy:!w.completedDates[i]}));
    for(const t of s.transactions){t.notes??='';t.receipt??=null;t.attachmentIds??=[];array(t.items,'$.state.transactions.items');for(const it of t.items){it.adjustment??='0';it.status??='kept';it.category??='Other';}if(t.recurringChargeId)t.oneTimeAmount??=0;}
    for(const b of s.recurringCharges){b.utilityType??='';b.active??=true;}
    s.legacyDemoCleanupVersion??=2;s.recurringChargesVersion??=1;s.datasetVersion??=1;
    const records=array(payload.attachments,'$.attachments');ids(records,'$.attachments');const map=new Map();
    for(let i=0;i<records.length;i++){const a=records[i],{bytes,mime}=decode(a.data,`$.attachments[${i}].data`);map.set(a.id,{...a,mimeType:mime,blob:new Blob([bytes],{type:mime})})}
    const b=await create(s,id=>map.get(id),{sourceVersion:2});if(map.size!==b.attachments.length)fail('$.attachments','unreferenced legacy evidence requires review');return b;
  }
  const api={FORMAT,VERSION,MAX_BYTES,clone,canonical,sha256,portableState,validateState,validate,create,convertV2,runtimeState,decode,dataURL,receiptType};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BackupUtils=api;
})(globalThis);

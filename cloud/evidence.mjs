import {toCloud,diff} from './ledger-model.mjs';
const MIME={'image/webp':'webp','image/jpeg':'jpg','image/png':'png'};
export const LIMIT=20*1024*1024;
export async function prepareImage(file){
 if(!file||!MIME[file.type])throw Error('Choose a JPEG, PNG, or WebP image.');
 if(!file.size||file.size>LIMIT)throw Error('Photo must be between 1 byte and 20 MiB.');
 let bitmap;
 try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw Error('Photo could not be decoded. Choose another image.');}
 try{const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error();ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 let blob=await new Promise(r=>canvas.toBlob(r,'image/webp',.82));if(!blob)blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob||!MIME[blob.type]||!blob.size||blob.size>LIMIT)throw Error();return blob;
 }catch{throw Error('Photo processing failed. No evidence was saved.');}finally{bitmap.close();}
}
export const journalKey=owner=>'50a-evidence-operation:'+owner;
const definitive=e=>/^(40001|42501|P0001|22|23)/.test(e?.code||'');
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
export class Evidence {
 constructor({client,repo,owner,storage,allowed=()=>true,online=()=>navigator.onLine,compress=prepareImage}){Object.assign(this,{client,repo,owner,storage,allowed,online,compress});this.bucket=client.storage.from('50a-evidence');}
 pending(){return JSON.parse(this.storage.getItem(journalKey(this.owner))||'null');}
 persist(j){this.storage.setItem(journalKey(this.owner),JSON.stringify(j));}
 async check(){if(!this.allowed()||!this.online())throw Error('Photo upload/view requires a connection and the signed-in ledger owner.');const {data,error}=await this.client.auth.getUser();if(error||data?.user?.id!==this.owner||!this.allowed())throw Error('Sign in as this ledger owner.');}
 async get(row){await this.check();if(!row||row.owner_id!==this.owner)throw Error('Evidence metadata unavailable.');const {data,error}=await this.bucket.download(row.storage_path,{}, {cache:'no-store'});if(error||!data||data.size!==row.size_bytes||data.type.split(';')[0]!==row.mime_type)throw Error('Private photo unavailable or incomplete. Retry online.');await this.check();return {id:row.id,transactionId:row.transaction_id||'condition:'+row.property_condition_id,fileName:row.original_filename,mimeType:row.mime_type,createdAt:row.created_at,blob:data};}
 async cleanup(j){
  await this.check();const cloud=await this.repo.loadLedger();
  for(const row of j.cleanup){if(cloud.rows.attachments.some(a=>a.storage_path===row.storage_path))throw Error('Evidence still referenced; cleanup paused.');await this.check();const {error}=await this.bucket.remove([row.storage_path]);if(error)throw Error('Photo cleanup incomplete. Use Resolve photo operation in Cloud settings.');}
  this.storage.removeItem(journalKey(this.owner));return cloud;
 }
 async resolve(){await this.check();const j=this.pending();if(!j)return this.repo.loadLedger();
  if(j.phase==='committing'){try{await this.repo.apply(j.op);j.phase='cleanup';j.cleanup=j.removed;this.persist(j);}catch(e){if(!definitive(e))throw Error('Photo completion unconfirmed. Retry Resolve photo operation online; do not repeat the save.');j.phase='cleanup';j.cleanup=j.uploads;this.persist(j);}}
  if(j.phase==='uploading'){j.phase='cleanup';j.cleanup=j.uploads;this.persist(j);}
  return this.cleanup(j);
 }
 async save(snapshot,state,files=[]){
  await this.check();if(this.pending())throw Error('Resolve the pending photo operation in Cloud settings first.');
  const next=structuredClone(state),uploads=[],blobs=[];
  for(const f of files){const blob=await this.compress(f.file),id=crypto.randomUUID(),property=f.parentType==='condition';const row={id,owner_id:this.owner,transaction_id:property?null:f.parentId,property_condition_id:property?f.parentId:null,storage_bucket:'50a-evidence',storage_path:`${this.owner}/${property?'property':'receipts'}/${id}.${MIME[blob.type]}`,original_filename:`photo.${MIME[blob.type]}`,mime_type:blob.type,size_bytes:blob.size,attachment_type:property?'property':'receipt'};uploads.push(row);blobs.push(blob);if(property){row.property_position=Math.max(-1,...snapshot.rows.attachments.filter(a=>a.property_condition_id===f.parentId).map(a=>a.property_position??0),...uploads.filter(a=>a!==row&&a.property_condition_id===f.parentId).map(a=>a.property_position??0))+1;const p=next.condition.find(p=>p.id===f.parentId);p.attachmentIds??=p.attachmentId?[p.attachmentId]:[];delete p.attachmentId;p.attachmentIds.push(id);}else next.transactions.find(t=>t.id===f.parentId).attachmentIds.push(id);}
  const mapped=toCloud(next,this.owner,{...snapshot.rows,attachments:[...snapshot.rows.attachments,...uploads]}),changes=diff(snapshot.rows,mapped),removed=snapshot.rows.attachments.filter(a=>!mapped.attachments.some(b=>b.id===a.id));
  const j={phase:'uploading',op:{id:crypto.randomUUID(),revision:snapshot.revision,changes},uploads,removed,cleanup:[]};this.persist(j);
  try{for(let i=0;i<uploads.length;i++){await this.check();const row=uploads[i],{error}=await this.bucket.upload(row.storage_path,blobs[i],{contentType:row.mime_type,cacheControl:'0',upsert:false});if(error)throw Error('Photo upload failed.');const check=await this.get(row);if(await digest(check.blob)!==await digest(blobs[i]))throw Error('Uploaded photo verification failed.');}}
  catch{j.phase='cleanup';j.cleanup=uploads;this.persist(j);await this.cleanup(j);throw Error('Photo upload failed; new objects cleaned up. Previous evidence is unchanged.');}
  await this.check();j.phase='committing';this.persist(j);
  try{await this.repo.apply(j.op);}catch(e){if(definitive(e)){j.phase='cleanup';j.cleanup=uploads;this.persist(j);await this.cleanup(j);throw Error(e.code==='40001'?'Cloud conflict: this ledger changed on another device. New uploads were cleaned up; your draft is retained. Cancel, refresh, and review before retrying.':'Photo save rejected; uploaded objects cleaned up. Refresh and retry.');}throw Error('Photo completion unconfirmed. Use Resolve photo operation before saving again.');}
  j.phase='cleanup';j.cleanup=removed;this.persist(j);
  try{return {snapshot:await this.cleanup(j),warning:null};}catch{return {snapshot:await this.repo.loadLedger(),warning:'Saved, but photo cleanup remains pending. Use Resolve photo operation in Cloud settings.'};}
 }
}

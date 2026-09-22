/* IDB generations + localStorage activation journal. Previous generations are retained. */
(function(root){
  const U=typeof module!=='undefined'&&module.exports?require('./backup-utils.js'):root.BackupUtils;
  const KEY='fiftyA-ledger-v1',DB='50a-ledger',VERSION=2;
  function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('attachments'))db.createObjectStore('attachments',{keyPath:'id'}).createIndex('transactionId','transactionId');if(!db.objectStoreNames.contains('recovery'))db.createObjectStore('recovery',{keyPath:'id'})};r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)};r.onerror=()=>reject(Error('Storage open failed'));r.onblocked=()=>reject(Error('Close other 50A tabs before restoring'))})}
  async function get(store,id){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store),r=tx.objectStore(store).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Storage read failed'))})}finally{db.close()}}
  async function write(operations){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction([...new Set(operations.map(o=>o.store))],'readwrite');tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(Error('Storage write failed'));try{for(const o of operations)tx.objectStore(o.store).put(o.value)}catch{tx.abort()}})}finally{db.close()}}
  const key=(generation,id)=>generation?`generation:${generation}:${id}`:id;
  async function attachment(id,generation){const r=await get('attachments',key(generation,id));return r?{...r,id}:null}
  async function putAttachment(record,generation){await write([{store:'attachments',value:{...record,id:key(generation,record.id)}}])}
  async function deleteAttachment(id,generation){const db=await open();try{await new Promise((resolve,reject)=>{const tx=db.transaction('attachments','readwrite');tx.objectStore('attachments').delete(key(generation,id));tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(Error('Storage delete failed'))})}finally{db.close()}}
  // Injected adapter makes each interruption boundary executable in deterministic tests.
  function coordinator(io){
    async function rollback(j){
      const raw=io.read();if(raw!==j.target&&raw!==j.before)throw Error('Recovery conflict: another tab changed the ledger; no data replaced');
      io.activate(j.before);await io.write([{store:'recovery',value:{...j,phase:'rolled-back'}}]);return {rolledBack:true};
    }
    async function verifyGeneration(j){
      const incoming=await io.get('recovery',j.incomingId);if(!incoming)throw Error('Staged backup missing');await U.validate(incoming.backup);
      if(io.read()!==j.target)throw Error('Activated state mismatch');
      const restored=JSON.parse(io.read());const rebuilt=await U.create(restored,id=>io.attachment(id,j.generation));
      if(U.canonical(rebuilt.state)!==U.canonical(incoming.backup.state)||U.canonical(rebuilt.manifest.attachments)!==U.canonical(incoming.backup.manifest.attachments))throw Error('Post-restore verification failed');
      return incoming.backup;
    }
    async function stage(backup,current,getAttachment){
      backup=U.clone(backup);await U.validate(backup);const prior=await io.get('recovery','journal');if(prior&&!['verified','rolled-back'].includes(prior.phase))throw Error('Activation failed: an earlier restore requires startup recovery');const before=io.read();
      let recovery;try{recovery=await U.create(current,getAttachment);await U.validate(recovery)}catch{throw Error('Recovery snapshot failed: current ledger or evidence did not validate; import blocked')}
      if(io.read()!==before)throw Error('Recovery snapshot failed: ledger changed in another tab');
      const generation=io.uuid(),incomingId=`incoming:${generation}`,recoveryId=`before:${generation}`;
      const target=JSON.stringify(U.runtimeState(backup,generation));let journal={id:'journal',phase:'prepared',generation,incomingId,recoveryId,before,target};
      try{
        // Snapshot, source artifact and journal commit atomically before staging bytes.
        await io.write([{store:'recovery',value:{id:recoveryId,backup:recovery}},{store:'recovery',value:{id:incomingId,backup}},{store:'recovery',value:journal}]);
        const ops=backup.attachments.map(a=>({store:'attachments',value:{id:key(generation,a.id),transactionId:a.parentType==='condition'?`condition:${a.parentId}`:a.parentId,kind:a.parentType==='condition'?'condition':'receipt',fileName:a.fileName,mimeType:a.mimeType,createdAt:a.createdAt,blob:new Blob([U.decode(a.data,'$.attachments.data').bytes],{type:a.mimeType})}}));
        journal={...journal,phase:'staged'};await io.write([...ops,{store:'recovery',value:journal}]);
      }catch{throw Error('Staged write failed: previous ledger retained; recovery journal will be checked at startup')}
      if(io.read()!==before)throw Error('Activation failed: ledger changed in another tab; previous state retained');
      try{io.activate(target);await io.write([{store:'recovery',value:{...journal,phase:'activated'}}])}catch{
        // localStorage activation may have succeeded even if the journal write failed.
        try{await rollback(journal)}catch{throw Error('Activation failed: recovery is pending; reload before editing')}
        throw Error('Activation failed: previous ledger restored');
      }
      return {generation,recoveryId};
    }
    async function recover(){
      const j=await io.get('recovery','journal');if(!j||['verified','rolled-back'].includes(j.phase))return {pending:false};
      if(io.read()===j.target&&['staged','activated'].includes(j.phase)){
        try{await verifyGeneration(j);return {pending:true}}catch{await rollback(j);return {pending:false,rolledBack:true}}
      }
      // Prepared/staged but never activated: old data is still authoritative.
      if(io.read()===j.before){await io.write([{store:'recovery',value:{...j,phase:'rolled-back'}}]);return {pending:false,rolledBack:true}}
      throw Error('Recovery conflict: another tab changed the ledger; recovery snapshots retained');
    }
    async function completeStartup(){const j=await io.get('recovery','journal');if(!j||!['staged','activated'].includes(j.phase))return;await verifyGeneration(j);await io.write([{store:'recovery',value:{...j,phase:'verified'}}])}
    async function startupFailed(){const j=await io.get('recovery','journal');if(j&&['prepared','staged','activated'].includes(j.phase))return rollback(j)}
    async function previousBackup(){const j=await io.get('recovery','journal');const r=j&&await io.get('recovery',j.recoveryId);if(!r)throw Error('No pre-import recovery snapshot available');await U.validate(r.backup);return r.backup}
    return {stage,recover,completeStartup,startupFailed,previousBackup};
  }
  const io={read:()=>localStorage.getItem(KEY),activate:value=>value===null?localStorage.removeItem(KEY):localStorage.setItem(KEY,value),get,write,attachment,uuid:()=>crypto.randomUUID()};
  const api={open,get,write,key,attachment,putAttachment,deleteAttachment,coordinator,...coordinator(io)};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BackupStorage=api;
})(globalThis);

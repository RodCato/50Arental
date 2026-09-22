/* Recover before application code reads localStorage or runs legacy migrations. */
(async()=>{
  const show=(message)=>{document.body.inert=false;const panel=document.createElement('div');panel.setAttribute('role','alert');panel.style.cssText='position:fixed;inset:0;z-index:99999;background:#fff;color:#17252a;padding:3rem';panel.textContent=message;document.body.append(panel)};
  document.body.inert=true;
  try{
    const status=await (navigator.locks?navigator.locks.request('50a-backup-restore',()=>BackupStorage.recover()):BackupStorage.recover());
    let failed=false;
    const fail=async()=>{if(failed)return;failed=true;try{await BackupStorage.startupFailed();show('Post-restore verification failed. Previous ledger retained. Reload to reopen it.')}catch{show('Recovery needs attention. Editing is blocked; both generations are retained. Close other tabs and reload.')}};
    window.addEventListener('error',fail,{once:true});
    window.backupStartupReady=async()=>{
      try{await BackupStorage.completeStartup();window.removeEventListener('error',fail);document.body.inert=false;if(status.pending)document.querySelector('#backupStatus').textContent='Restore successful. Reopened state and attachment hashes verified.';if(status.rolledBack)document.querySelector('#backupStatus').textContent='Interrupted restore recovered. Previous ledger retained.'}catch{await fail()}
    };
    const script=document.createElement('script');script.src='./app.js';script.onerror=fail;document.body.append(script);
  }catch{show('Recovery could not complete. Editing is blocked; stored ledger and recovery snapshots are retained. Close other tabs and reload.')}
})();

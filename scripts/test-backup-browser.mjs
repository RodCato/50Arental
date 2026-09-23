/* Synthetic isolated Chromium context. Never connects to an existing user profile. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {historicalNumericFixture:fixture}=require('../tests/backup-fixture.cjs');
const U=require('../backup-utils.js');
const playwright=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=require(playwright);
const root=path.resolve('.');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep))throw Error();const bytes=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(bytes)}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const context=await browser.newContext({serviceWorkers:'block'}); // Never user storage.
 await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 console.log('Browser launched');const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);console.log('App page loaded');await page.waitForFunction(()=>typeof BackupUtils!=='undefined'&&typeof state!=='undefined'&&!document.body.inert);
 console.log('Startup ready');
 // A fresh app's real default dataset must also be exportable.
 const fresh=await page.evaluate(async()=>{const b=await BackupUtils.create(state,attachmentGet);return (await BackupUtils.validate(b)).summary});assert.ok(fresh.transactions>0);console.log('Fresh export passed');
 const f=fixture(),b=await U.create(f.state,f.get);assert.equal(b.state.transactions[5].items[0].adjustment,'');const data=JSON.stringify(b);
 page.on('dialog',dialog=>dialog.accept());
 await page.locator('#importInput').setInputFiles({name:'synthetic-v3.json',mimeType:'application/json',buffer:Buffer.from(data)});
 await page.waitForFunction(()=>document.querySelector('#backupStatus')?.textContent.includes('Restore successful'));console.log('Restore reopened');
 assert.equal(errors.length,0,errors.join('\n'));
 const first=await page.evaluate(async()=>{
   const r=await attachmentGet('receipt'),blobURL=URL.createObjectURL(r.blob),img=new Image();img.src=blobURL;await img.decode();const dimensions=[img.naturalWidth,img.naturalHeight];URL.revokeObjectURL(blobURL);
   const fileReaderBytes=await fileData(r.blob);const b=await BackupUtils.create(state,attachmentGet);return {b,dimensions,fileReaderBytes,phase:(await BackupStorage.get('recovery','journal')).phase};
 });
 assert.equal(first.phase,'verified');assert.deepEqual(first.dimensions,[1,1]);assert.equal(first.fileReaderBytes,b.attachments[0].data);assert.deepEqual(first.b.state,b.state);assert.deepEqual(first.b.manifest,b.manifest);
 await page.reload();await page.waitForFunction(()=>typeof state!=='undefined'&&!document.body.inert);
 const second=await page.evaluate(async()=>await BackupUtils.create(state,attachmentGet));assert.deepEqual(second.state,b.state);assert.deepEqual(second.manifest,b.manifest);
 // Exercise actual exported download and independent validator.
 await page.locator('[data-tab="settings"]').click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#exportBtn').click()]);
 const stream=await download.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);const exported=JSON.parse(Buffer.concat(chunks));assert.deepEqual(exported.manifest,b.manifest);await U.validate(exported);
 // Real IDB transaction abort before activation keeps previous localStorage intact.
 const aborted=await page.evaluate(async()=>{const before=localStorage.getItem('fiftyA-ledger-v1'),db=await BackupStorage.open();await new Promise(resolve=>{const tx=db.transaction('attachments','readwrite');tx.objectStore('attachments').put({id:'synthetic-aborted'});tx.onabort=resolve;tx.abort()});db.close();return {same:localStorage.getItem('fiftyA-ledger-v1')===before,missing:!(await BackupStorage.get('attachments','synthetic-aborted'))}});assert.deepEqual(aborted,{same:true,missing:true});
 // An activated generation interrupted before startup is verified on real reload.
 await page.evaluate(async()=>{const b=await BackupUtils.create(state,attachmentGet);await BackupStorage.stage(b,state,attachmentGet)});
 await page.reload();await page.waitForFunction(()=>document.querySelector('#backupStatus')?.textContent.includes('Restore successful'));console.log('Restore reopened');
 assert.equal(errors.length,0,errors.join('\n'));
 // Legacy v2 UI conversion retains original meaningful fields without historical rewrites.
 const v2={format:U.FORMAT,version:2,state:f.state,attachments:b.attachments.map(a=>({...a,transactionId:a.parentType==='condition'?'condition:'+a.parentId:a.parentId}))};
 await page.locator('#importInput').setInputFiles({name:'synthetic-v2.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(v2))});
 await page.waitForFunction(()=>document.querySelector('#backupStatus')?.textContent.includes('Restore successful'));
 const legacyRestored=await page.evaluate(async()=>await BackupUtils.create(state,attachmentGet));assert.deepEqual(legacyRestored.state,b.state);assert.equal(legacyRestored.provenance.sourceVersion,2);
 // Fail actual application render on the next activated-generation startup.
 const beforeRenderFailure=await page.evaluate(()=>localStorage.getItem('fiftyA-ledger-v1'));
 await page.evaluate(async()=>{const b=await BackupUtils.create(state,attachmentGet);await BackupStorage.stage(b,state,attachmentGet)});
 const appSource=await readFile(path.join(root,'app.js'),'utf8');
 await page.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:appSource.replace('render();window.backupStartupReady?.();',"throw new Error('Synthetic render failure');")}));
 await page.reload();await page.waitForFunction(()=>document.body.textContent.includes('Post-restore verification failed. Previous ledger retained.'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('fiftyA-ledger-v1')),beforeRenderFailure);
 await page.unroute('**/app.js');await page.reload();await page.waitForFunction(()=>typeof state!=='undefined'&&!document.body.inert);
 assert.equal(errors.length,1);assert.equal(errors[0],'Synthetic render failure');
 console.log('Browser PASS: fresh export; confirmed UI import; real IDB staging/abort; PNG decode/display; FileReader/Blob bytes unchanged; reload/re-export hashes identical; interrupted activation recovered; legacy v2 UI conversion; actual render failure rolled back and reopened. No user profile or remote services accessed.');
 await context.close();
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r))}

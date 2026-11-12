import {navigateTo} from '../tests/navigation.mjs';
// Disposable local profiles and synthetic fixtures only; never user browser storage.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const workerSource=await readFile('sw.js','utf8');
assert.equal(await readFile('dist/sw.js','utf8'),workerSource,'Built worker must match release source');
assert.equal(JSON.parse(await readFile('dist/cloud-config.json','utf8')).enabled,false,'Offline fixture must not connect to production');
const expectedCache=workerSource.match(/const CACHE_NAME='([^']+)'/)[1],priorCache=expectedCache+'-synthetic-prior';
const uiAssets=['housing-ui.js','lease-ui.js','automotive-ui.js','utilities-ui.js','cloud-foundation.js'];
let serveCurrent=false;
const server=createServer(async(req,res)=>{try{
 const name=new URL(req.url,'http://localhost').pathname;if(name.includes('..'))throw Error();
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')||name.endsWith('.webmanifest')?'application/json':'text/html');
 res.setHeader('Cache-Control','no-store');
 res.end(name==='/sw.js'?(serveCurrent?workerSource:workerSource.replace(expectedCache,priorCache)):await readFile('dist'+(name==='/'?'/index.html':name)));
}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
const ready=page=>page.waitForFunction(()=>window.LedgerApp&&window.LeaseTrackerUI&&window.UtilityAnalytics&&document.querySelector('#housingDialog')&&document.querySelector('#vehicleDialog')&&!document.body.inert);
const stored=page=>page.evaluate(async()=>({
 local:Object.fromEntries(Object.entries({...localStorage}).sort()),
 attachment:await (await BackupStorage.get('attachments','synthetic-evidence')).blob.text(),
 recovery:await BackupStorage.get('recovery','synthetic-preservation'),
 unrelated:await (await (await caches.open('unrelated-cache')).match('/synthetic-cache')).text()
}));
async function verifyViews(page){
 await navigateTo(page,'[data-tab=overview]');assert.match(await page.locator('#housingCoverageCard').textContent(),/Housing target/);
 assert.equal(await page.locator('#housingDialog').count(),1);assert.equal(await page.locator('#leaseDialog').count(),1);
 assert.equal(await page.locator('#leaseTracker').evaluate(e=>e.open),false);
 await navigateTo(page,'[data-tab=income]');assert.match(await page.locator('#housingIncome').textContent(),/Monthly net income \(all sources\): \$1,234.56/);assert.match(await page.locator('#housingIncome').textContent(),/Offline income fixture/);
 await navigateTo(page,'[data-tab=recurring]');assert(await page.locator('[data-edit-bill]').count()>0);
 await navigateTo(page,'[data-tab=monthly]');assert.equal(await page.locator('#utilityPaymentHistory').count(),1);assert.equal(await page.locator('#beneficiaryFilter').count(),1);
 await navigateTo(page,'[data-tab=automotive]');const vehicle=await page.evaluate(()=>LedgerApp.get().vehicles.at(-1).id);await page.locator('#autoVehicle').selectOption(vehicle);assert.match(await page.locator('#autoMetrics').textContent(),/30.0 mpg/);assert.equal(await page.locator('#autoMpgChart circle').count(),1);
}
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 for(const width of [320,390,1280])for(let attempt=1;attempt<=2;attempt++){
  serveCurrent=false;const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],failed=[],responses=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(new URL(r.url()).pathname));
  page.on('response',r=>responses.push({path:new URL(r.url()).pathname,status:r.status(),worker:r.fromServiceWorker()}));
  // Catch-all routing makes Chromium speculative deferred scripts bypass the SW
  // when offline. Leave local requests native; still block every external origin.
  await context.route(url=>url.origin!==origin,r=>r.abort());
  await context.addInitScript(()=>{window.offlineRejections=[];addEventListener('unhandledrejection',e=>offlineRejections.push(String(e.reason)));});
  await page.clock.setFixedTime(new Date('2026-10-24T17:00:00Z'));await page.goto(origin);await ready(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>navigator.serviceWorker.controller);assert(await page.evaluate(name=>caches.has(name),priorCache));
  await page.evaluate(async()=>{
   let s=LedgerApp.get();s=HousingUtils.put(s,'income_sources',{id:'offline-source',name:'Offline income fixture',source_type:'employment',active:true,hourly_rate_cents:null,typical_shift_hundredths:null});
   s=HousingUtils.put(s,'paychecks',{income_source_id:'offline-source',pay_date:'2026-10-12',net_cents:123456,period_start:null,period_end:null,gross_cents:null,notes:'Synthetic preservation fixture'});
   s=AutomotiveUtils.saveVehicle(s,{ownerId:null,nickname:'Offline fixture',year:null,make:null,model:null,active:true});const id=s.vehicles.at(-1).id;
   for(const [fillDate,odometer]of [['2026-10-01','1000'],['2026-10-11','1300']])s=AutomotiveUtils.saveFuel(s,{ownerId:null,vehicleId:id,fillDate,odometer,totalCost:'30',gallons:'10',pricePerGallon:null,fullTank:true,station:null,notes:null,transactionId:null});LedgerApp.commit(s);
   localStorage.setItem('50a-cloud:synthetic-inactive-owner',JSON.stringify({owner:'synthetic-inactive-owner',queue:[{id:'pending',changes:{user_settings:{put:[{lease_tracker:LeaseUtils.empty()}],remove:[]}}}]}));
   await BackupStorage.putAttachment({id:'synthetic-evidence',blob:new Blob(['synthetic evidence'])});await BackupStorage.write([{store:'recovery',value:{id:'synthetic-preservation',intent:'retain recovery'}}]);
   await (await caches.open('unrelated-cache')).put('/synthetic-cache',new Response('unrelated bytes'));
  });
  const before=await page.evaluate(()=>JSON.stringify(LedgerApp.get())),storageBefore=await stored(page);await verifyViews(page);serveCurrent=true;
  await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
  await page.waitForFunction(async({expected,prior})=>(await caches.has(expected))&&!(await caches.has(prior)),{expected:expectedCache,prior:priorCache});
  await page.reload();await ready(page);await verifyViews(page);assert.deepEqual(await stored(page),storageBefore);
  // Installed-worker online→offline reload, then another fresh offline document.
  await context.setOffline(true);
  for(let reload=0;reload<2;reload++){
   responses.length=0;failed.length=0;await page.reload();await ready(page);await verifyViews(page);
   for(const asset of uiAssets){assert(responses.some(r=>r.path==='/'+asset&&r.status===200&&r.worker),`${asset} must actually load through the service worker offline`);assert(!failed.includes('/'+asset),`${asset} must not fail silently`);}
   assert.equal(await page.evaluate(()=>JSON.stringify(LedgerApp.get())),before);assert.deepEqual(await stored(page),storageBefore);assert.deepEqual(await page.evaluate(()=>offlineRejections),[]);
   assert(await page.evaluate(name=>caches.has(name),expectedCache));assert(!(await page.evaluate(name=>caches.has(name),priorCache)));assert.equal(await page.locator('#housingDialog').count(),1);
  }
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px run ${attempt}: ${expectedCache} upgrade and repeated offline reload, actual income/fuel fixtures and all UI initializers; ledger, queue, IDB evidence/recovery and unrelated cache unchanged.`);
 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r))}

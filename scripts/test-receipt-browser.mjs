// Synthetic review tests; all external network traffic blocked, zero OpenAI calls.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {receiptResponse} from '../tests/receipt-fixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',ids=['11111111-1111-4111-a111-111111111111','22222222-2222-4222-a222-222222222222'];
const entry=`import {receiptReview} from './receipt-review.mjs';
window.callbacks=[];window.signedIn=true;window.applied=[];window.ledger={transactions:[{id:'transaction',merchant:'Original',date:'2026-09-01',attachmentIds:${JSON.stringify(ids)},items:[{name:'Existing',amount:'1.00'}]}]};
localStorage.setItem('ledger-canary',JSON.stringify(window.ledger));const user={id:'${owner}'};
const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-token',user}}}),onAuthStateChange:fn=>window.callbacks.push(fn)}};
receiptReview(client,{allowed:()=>window.signedIn,owner:()=>window.signedIn?user.id:null,getTransaction:()=>window.ledger.transactions[0],applyDraft:(id,draft,expected)=>window.applied.push({id,draft,expected}),mountImage:(slot,id,alt)=>{const image=document.createElement('span');image.textContent=alt;slot.append(image);return ()=>image.remove()}});
window.signOut=()=>{window.signedIn=false;window.callbacks.forEach(fn=>fn('SIGNED_OUT',null))};window.signIn=()=>{window.signedIn=true};`;
const bundle=(await build({stdin:{contents:entry,resolveDir:process.cwd()+'/cloud'},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
let server,browser,requests=[],mode='success',delay=0;
try{
 server=createServer(async(req,res)=>{
  if(req.url==='/api/receipt-ocr'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);requests.push({body:JSON.parse(Buffer.concat(chunks)),authorization:req.headers.authorization,method:req.method});const current=mode;await new Promise(r=>setTimeout(r,delay));
   const output=structuredClone(receiptResponse);output.extraction.merchant='<img src=x onerror="window.injected=true">';
   if(current==='long'){output.extraction.items=Array.from({length:32},(_,i)=>({...output.extraction.items[i%4],description:`Synthetic item ${i+1}`,total_price:1,unit_price:1}));Object.assign(output.extraction,{subtotal:32,tax:2,total:34});}
   res.writeHead(current==='failure'?429:200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(current==='failure'?{error:{message:'Analysis is rate limited. Wait before pressing Retry.'}}:output));return;
  }
  if(req.url==='/review.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
  if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(await readFile('styles.css'));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><button data-analyze-receipt="transaction">Analyze receipt</button><script src="/review.js"></script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 for(const viewport of [{width:1200,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let accept=false;page.on('dialog',d=>accept?d.accept():d.dismiss());await page.goto(origin);
  const before=await page.evaluate(()=>({ledger:JSON.stringify(window.ledger),storage:JSON.stringify(localStorage)})),dialog=page.locator('#receiptReview'),analyze=dialog.locator('[data-analyze]');
  const open=()=>page.locator('[data-analyze-receipt]').click(),done=()=>page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Analysis complete'));
  await open();assert.equal(requests.length,0);await dialog.getByRole('checkbox',{name:'Select image 2'}).check();assert(await analyze.isDisabled());await dialog.locator('[data-same]').check();await dialog.getByRole('button',{name:'Move up image 2',exact:true}).click();delay=250;await analyze.click();assert(await analyze.isDisabled());await done();assert.equal(requests.length,1);assert.deepEqual(requests[0].body,{attachment_ids:[ids[1],ids[0]]});assert.equal(requests[0].authorization,'Bearer synthetic-token');
  assert.equal(await dialog.locator('[data-result] img').count(),0);assert.equal(await page.evaluate(()=>!!window.injected),false);assert.match(await dialog.locator('[data-reconciliation]').textContent(),/Difference: \$0.00/);assert.equal(await dialog.locator('[data-review-field=transaction_date]').inputValue(),'');assert.equal(await dialog.locator('[data-review-item]').count(),4);assert.equal(await dialog.getByRole('button',{name:'Save transaction',exact:true}).count(),0);
  const first=dialog.locator('[data-review-item]').first();assert.match(await first.locator('[data-suggestion]').textContent(),/AI suggested/);await first.getByLabel('Category',{exact:true}).selectOption('Cleaning');assert.match(await first.locator('[data-suggestion]').textContent(),/User changed/);
  await dialog.getByRole('button',{name:'Select all',exact:true}).click();await dialog.getByLabel('Bulk category',{exact:true}).selectOption('Groceries');await dialog.getByRole('button',{name:'Assign selected',exact:true}).click();assert.deepEqual(await dialog.locator('[data-review-item] select[aria-label=Category]').evaluateAll(es=>es.map(e=>e.value)),Array(4).fill('Groceries'));assert.equal(await dialog.locator('[data-review-item] input:checked').count(),0);
  await dialog.locator('[data-review-item]').last().getByRole('button',{name:'Remove item'}).click();await dialog.getByRole('button',{name:'Add missing item'}).click();const last=dialog.locator('[data-review-item]').last();await last.getByLabel('Description',{exact:true}).fill('User added item');await last.getByLabel('Charged item total',{exact:true}).fill('20');await last.getByLabel('Category',{exact:true}).selectOption('Cleaning');await dialog.getByLabel('Merchant',{exact:true}).fill('Reviewed merchant');
  await dialog.locator('[data-apply-receipt]').click();assert(await dialog.isVisible());assert.equal(await page.evaluate(()=>window.applied.length),0,'Replacement cancellation must not apply');accept=true;await dialog.locator('[data-apply-receipt]').click();assert(!(await dialog.isVisible()));const applied=await page.evaluate(()=>window.applied[0]);assert.equal(applied.draft.items.length,5);assert.equal(applied.draft.date,'');assert.equal(applied.draft.merchant,'Reviewed merchant');assert.equal(applied.draft.items.at(-1).bucket,'tax');assert.equal(applied.draft.items.at(-1).amount,'5.30');assert.equal(applied.draft.items.at(-2).name,'User added item');assert.deepEqual(await page.evaluate(()=>({ledger:JSON.stringify(window.ledger),storage:JSON.stringify(localStorage)})),before);
  await open();mode='failure';delay=0;await analyze.click();await page.waitForFunction(()=>document.querySelector('[data-analyze]').textContent==='Retry');const failures=requests.length;await page.waitForTimeout(150);assert.equal(requests.length,failures);mode='long';await analyze.click();await done();assert.equal(await dialog.locator('[data-review-item]').count(),32);assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await dialog.getByRole('button',{name:'Select all',exact:true}).click();await dialog.getByLabel('Bulk category',{exact:true}).selectOption('Groceries');await dialog.getByRole('button',{name:'Assign selected',exact:true}).click();assert.equal(await dialog.locator('[data-review-item] select[aria-label=Category]').evaluateAll(es=>es.filter(e=>e.value==='Groceries').length),32);
  if(viewport.width===390&&process.env.RECEIPT_REVIEW_SCREENSHOT){await dialog.locator('[data-review-item]').first().scrollIntoViewIfNeeded();await page.screenshot({path:process.env.RECEIPT_REVIEW_SCREENSHOT});}
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-result]').textContent);await open();assert.equal(await dialog.locator('[data-result]').textContent(),'');mode='success';delay=500;await analyze.click();await page.evaluate(()=>window.signOut());await page.waitForTimeout(600);assert(!(await dialog.isVisible()));assert.equal(await dialog.locator('[data-result]').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>({ledger:JSON.stringify(window.ledger),storage:JSON.stringify(localStorage)})),before);
  await context.close();requests=[];mode='success';delay=0;
 }
 console.log('Receipt review browser: PASS · desktop/390px · edits, bulk 32 items, add/remove, explicit replacement/cancel, form-only Apply, ordered images, retry, XSS, sign-out and zero persistence');
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}

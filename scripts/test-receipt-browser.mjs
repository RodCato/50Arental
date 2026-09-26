// Synthetic, isolated review UI: no production service or OpenAI traffic.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',ids=['11111111-1111-4111-a111-111111111111','22222222-2222-4222-a222-222222222222'];
const receipt={merchant:'<img src=x onerror="window.injected=true">',transaction_date:null,transaction_time:null,subtotal:2,tax:.2,tip:null,discounts:null,total:9.99,currency:'USD',items:[{description:'SYNTHETIC ITEM',quantity:1,unit_price:2,total_price:2,sku:null,raw_text:'ITEM 2.00',confidence:null}],warnings:['Date unreadable','Visible totals do not reconcile'],overall_confidence:null};
const entry=`import {receiptReview} from './receipt-review.mjs';
window.callbacks=[];window.signedIn=true;window.ledger={transactions:[{id:'transaction',attachmentIds:${JSON.stringify(ids)},items:[]}]};
localStorage.setItem('ledger-canary',JSON.stringify(window.ledger));
const user={id:'${owner}'};
const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-token',user}}}),onAuthStateChange:fn=>window.callbacks.push(fn)}};
receiptReview(client,{allowed:()=>window.signedIn,owner:()=>window.signedIn?user.id:null,getTransaction:()=>window.ledger.transactions[0],mountImage:(slot,id,alt)=>{const image=document.createElement('span');image.textContent=alt;slot.append(image);return ()=>image.remove()}});
window.signOut=()=>{window.signedIn=false;window.callbacks.forEach(fn=>fn('SIGNED_OUT',null))};window.signIn=()=>{window.signedIn=true};`;
const bundle=(await build({stdin:{contents:entry,resolveDir:process.cwd()+'/cloud'},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
let server,browser,requests=[],mode='success',delay=0;
try{
 server=createServer(async(req,res)=>{
  if(req.url==='/api/receipt-ocr'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push({body,authorization:req.headers.authorization,method:req.method});const current=mode;await new Promise(r=>setTimeout(r,delay));
   res.writeHead(current==='success'?200:429,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(current==='success'?{extraction:receipt,usage:{model:'synthetic-model',input_tokens:100,output_tokens:50,total_tokens:150}}:{error:{message:'Analysis is rate limited. Wait before pressing Retry.'}}));return;
  }
  if(req.url==='/review.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
  if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(await readFile('styles.css'));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><button data-analyze-receipt="transaction">Analyze receipt</button><script src="/review.js"></script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 for(const viewport of [{width:1200,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);const before=await page.evaluate(()=>({ledger:JSON.stringify(window.ledger),storage:JSON.stringify(localStorage)}));
  const dialog=page.locator('#receiptReview'),analyze=dialog.locator('[data-analyze]'),status=dialog.locator('[data-status]');
  await page.locator('[data-analyze-receipt]').click();assert.equal(requests.length,0);assert(await dialog.isVisible());assert.match(await dialog.textContent(),/sent to OpenAI/);
  await dialog.getByRole('checkbox',{name:'Select image 2'}).check();assert(await analyze.isDisabled());await dialog.locator('[data-same]').check();await dialog.getByRole('button',{name:'Move up image 2',exact:true}).click();
  delay=250;await analyze.click();assert(await analyze.isDisabled());await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Analysis complete'));assert.equal(requests.length,1);assert.deepEqual(requests[0].body,{attachment_ids:[ids[1],ids[0]]});assert.equal(requests[0].method,'POST');assert.equal(requests[0].authorization,'Bearer synthetic-token');
  assert.equal(await dialog.locator('[data-result] img').count(),0);assert.equal(await page.evaluate(()=>!!window.injected),false);assert.match(await dialog.locator('[data-result]').textContent(),/9.99/);assert.match(await dialog.locator('[data-result]').textContent(),/Not readable/);assert.match(await dialog.locator('[data-result]').textContent(),/SYNTHETIC ITEM/);assert.equal(await dialog.getByRole('button',{name:/Apply|Save|Create/}).count(),0);
  assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));if(viewport.width===390&&process.env.RECEIPT_REVIEW_SCREENSHOT)await page.screenshot({path:process.env.RECEIPT_REVIEW_SCREENSHOT});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-result]').textContent);assert.equal(await dialog.locator('[data-images]').textContent(),'');
  await page.locator('[data-analyze-receipt]').click();mode='failure';delay=0;await analyze.click();await page.waitForFunction(()=>document.querySelector('[data-analyze]').textContent==='Retry');assert.match(await status.textContent(),/rate limited/);assert.equal(requests.length,2);await page.waitForTimeout(150);assert.equal(requests.length,2);
  mode='success';await analyze.click();await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Analysis complete'));assert.equal(requests.length,3);
  delay=500;await analyze.click();await page.waitForFunction(()=>document.querySelector('[data-analyze]').disabled);await page.evaluate(()=>window.signOut());await page.waitForTimeout(600);assert(!(await dialog.isVisible()));assert.equal(await dialog.locator('[data-result]').textContent(),'');
  const after=await page.evaluate(()=>({ledger:JSON.stringify(window.ledger),storage:JSON.stringify(localStorage)}));assert.deepEqual(after,before);assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.signIn());await page.locator('[data-analyze-receipt]').click();assert.equal(await dialog.locator('[data-result]').textContent(),'');await page.reload();assert(!(await dialog.isVisible()));assert.equal(await dialog.locator('[data-result]').textContent(),'');
  await context.close();requests=[];mode='success';delay=0;
 }
 console.log('Receipt review browser: PASS · desktop + phone · ordered selection, explicit requests/retry, XSS safety, no writes/persistence, sign-out/late response cleanup');
}finally{await browser?.close();await new Promise(r=>server?server.close(r):r())}

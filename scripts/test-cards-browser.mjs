// Synthetic UI only: isolated browser storage, no cloud or OpenAI access.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
let browser;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path.includes('..'))throw Error();res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'text/html');res.end(await readFile('dist'+(path==='/'?'/index.html':path)))}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 for(const width of [1200,390]){
 const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>window.LedgerApp);
 await page.evaluate(()=>{
  const item=(name,amount='1',bucket='groceries')=>({name,amount,bucket,category:bucket==='groceries'?'Groceries':'Other',setupClass:'none',status:'kept',adjustment:'0'}),tax=item('Sales tax','2.13','tax');
  const canvas=document.createElement('canvas');canvas.width=40;canvas.height=60;canvas.getContext('2d').fillRect(0,0,40,60);const receipt=canvas.toDataURL();
  const tx=(id,items)=>({id,merchant:id,date:'2026-09-23',items,attachmentIds:[],receipt:null,notes:''});
  const data=LedgerApp.empty();data.transactions=[tx('Empty',[]),tx('One',[item('Electricity','93','utilities')]),tx('Tax only',[tax]),tx('One plus tax',[item('One item'),tax]),tx('Walmart',[item('AVOCADO BAG','3.48'),item('CHINO PANT','19.98','excluded'),tax]),...Array.from({length:3},(_,i)=>tx('Small '+i,[item('One')])),...Array.from({length:3},(_,i)=>tx('Medium '+i,Array.from({length:5+i},(_,j)=>item('Item '+j)))),tx('Large', [...Array.from({length:32},(_,i)=>item('Grocery '+i)),tax])];data.transactions.find(t=>t.id==='Walmart').receipt=receipt;data.transactions.at(-1).receipt=receipt;LedgerApp.set(data);
 });
 await page.locator('[data-tab=monthly]').click();await page.locator('#monthInput').fill('2026-09');await page.locator('#monthInput').dispatchEvent('change');
 const cards=page.locator('#monthlyTransactions .transaction-card'),card=name=>cards.filter({has:page.getByRole('heading',{name,exact:true})}),large=card('Large'),summary=large.locator('summary');
 const financial=()=>page.evaluate(()=>({state:LedgerApp.get(),totals:FinanceUtils.expenses(LedgerApp.get().transactions),benchmark:FinanceUtils.benchmark(LedgerApp.get().settings,LedgerApp.get().recurringCharges),metrics:[...document.querySelectorAll('#monthly .metric')].map(e=>e.textContent)}));const before=await financial();
 assert.equal(await cards.count(),11);assert.equal(await cards.locator('details[open]').count(),0);assert.equal(await card('One').locator('details').count(),0);assert(await card('One').locator('.item-row').isVisible());assert.equal(await card('Empty').count(),0,'Existing Monthly filter omits empty transactions');assert.equal(await page.evaluate(async()=>{const root=document.createElement('div');root.id='cardEdgeCase';document.body.append(root);await renderTransactions('#cardEdgeCase',[LedgerApp.get().transactions.find(t=>t.id==='Empty')]);const text=root.textContent;root.remove();return text.includes('No items')}),true);assert.equal(await card('Tax only').locator('summary').textContent(),'Tax');assert.equal(await card('One plus tax').locator('summary').textContent(),'1 item + tax');assert.equal(await card('Walmart').locator('summary').textContent(),'2 items + tax');assert.match(await card('Walmart').locator('.transaction-top').textContent(),/25.59/);assert(await card('Walmart').locator('img').isVisible());assert.equal(await cards.locator('[data-analyze-receipt]').count(),0);
 assert.equal(await summary.textContent(),'32 items + tax');assert.equal(await large.locator('.item-row:visible').count(),0);assert(await large.locator('img').isVisible());const collapsed=await large.evaluate(e=>e.getBoundingClientRect().height);assert(collapsed<260);assert.equal(await cards.locator('.item-row:visible').count(),4,'Only the four simple transactions are expanded');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await summary.focus();assert((await summary.boundingBox()).height>=44);await summary.press('Enter');assert(await large.locator('details').evaluate(e=>e.open));assert.equal(await large.locator('.item-row:visible').count(),33);assert.match(await large.locator('.item-row').last().textContent(),/Sales tax.*kept.*Other · tax.*2.13/);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(await financial(),before);
 await summary.press('Space');assert.equal(await large.locator('details').evaluate(e=>e.open),false);assert.equal(await large.evaluate(e=>e.getBoundingClientRect().height),collapsed);
 await card('Walmart').locator('summary').click();assert.match(await card('Walmart').textContent(),/AVOCADO BAG.*Groceries · groceries/);assert.match(await card('Walmart').textContent(),/CHINO PANT.*Other · excluded/);await card('Walmart').locator('summary').click();assert.deepEqual(await financial(),before);
 if(width===390&&process.env.CARDS_SCREENSHOT){await large.scrollIntoViewIfNeeded();await page.screenshot({path:process.env.CARDS_SCREENSHOT});}
 assert.deepEqual(errors,[]);await context.close();console.log(`PASS: ${width}px compact cards, zero/one/tax edges, 32+tax, mixed Monthly page, native keyboard disclosure, unchanged full-state/calculations, thumbnails.`);
 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

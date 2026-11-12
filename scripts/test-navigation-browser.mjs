// Disposable local browser only; no imports, exports, restores or remote requests.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {navigateTo} from '../tests/navigation.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.includes('..'))throw Error();res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':'text/html');res.end(await readFile('dist'+(p==='/'?'/index.html':p)))}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<500,serviceWorkers:'block'});
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>window.LedgerApp&&!document.body.inert);
  const before=await page.evaluate(()=>({ledger:JSON.stringify(LedgerApp.get()),storage:JSON.stringify({...localStorage})})),toggle=page.locator('#navigationToggle'),nav=page.locator('#mainNavigation');
  assert.equal(await nav.isVisible(),false);assert.equal(await toggle.getAttribute('aria-controls'),'mainNavigation');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('main .tabs').count(),0);assert.equal(await page.locator('header nav').count(),1);
  assert.deepEqual(await nav.locator('.tab').allTextContents(),['Overview','Monthly','Monthly bills','Setup','Income','Automotive','Property','Settings']);
  await toggle.focus();await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'overview');assert.equal(await page.locator('.tab:focus-visible').count(),1);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'monthly');await page.keyboard.press('Enter');assert.equal(await nav.isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'navigationToggle');assert.equal(await page.locator('.tab-panel.active').getAttribute('id'),'monthly');
  await toggle.press('Space');await page.keyboard.press('Escape');assert.equal(await nav.isVisible(),false);assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>document.activeElement.id),'navigationToggle');
  await toggle.click();await page.locator('h1').click();assert.equal(await nav.isVisible(),false);
  await toggle.click();await nav.locator('[data-tab=monthly]').focus();await page.locator('#monthInput').click();assert.equal(await nav.isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'monthInput');
  await toggle.click();await nav.locator('.tab').last().focus();await page.keyboard.press('Tab');assert.equal(await nav.isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'seedBtn');
  for(const section of ['overview','monthly','recurring','setup','income','automotive','property','settings']){
   await toggle.click();if(width<500)await nav.locator(`[data-tab=${section}]`).tap();else await nav.locator(`[data-tab=${section}]`).click();
   assert.equal(await nav.isVisible(),false);assert.equal(await page.locator('.tab-panel.active').count(),1);assert.equal(await page.locator('.tab-panel.active').getAttribute('id'),section);assert.equal(await nav.locator('[aria-current=page]').getAttribute('data-tab'),section);assert.equal(await nav.locator('.active').getAttribute('data-tab'),section);
  }
  await navigateTo(page,'[data-tab=monthly]');await page.locator('#monthInput').fill('2026-09');await page.locator('[data-month-filter=utilities]').click();await navigateTo(page,'[data-tab=overview]');await navigateTo(page,'[data-tab=monthly]');assert.equal(await page.locator('#monthInput').inputValue(),'2026-09');assert(await page.locator('[data-month-filter=utilities]').evaluate(n=>n.classList.contains('active')));
  await page.locator('#addTransactionBtn').click();assert(await page.locator('#transactionDialog [type=submit]').isVisible());assert(await page.locator('#transactionDialog [data-dialog-dismiss]').first().isVisible());await page.locator('#transactionDialog [name=merchant]').fill('Unsaved navigation test');await page.locator('#transactionDialog [data-dialog-dismiss]').first().click();
  // Existing Settings shortcut uses the same section mechanism and semantic active state.
  await page.evaluate(()=>{const b=document.createElement('button');b.dataset.openSettings='';document.body.append(b);b.click();b.remove()});assert.equal(await nav.locator('[aria-current=page]').getAttribute('data-tab'),'settings');
  // Header navigation must remain unavailable during the existing main busy/owner lock.
  await toggle.click();await page.evaluate(()=>document.querySelector('main').inert=true);await page.waitForFunction(()=>document.querySelector('#navigationToggle').disabled);assert.equal(await nav.isVisible(),false);await page.evaluate(()=>document.querySelector('[data-tab=overview]').click());assert.equal(await page.locator('.tab-panel.active').getAttribute('id'),'settings');await page.evaluate(()=>document.querySelector('main').inert=false);await page.waitForFunction(()=>!document.querySelector('#navigationToggle').disabled);
  await toggle.click();await page.evaluate(()=>document.body.classList.add('cloud-locked'));await page.waitForFunction(()=>document.querySelector('#navigationToggle').disabled);assert.equal(await nav.isVisible(),false);await page.evaluate(()=>document.body.classList.remove('cloud-locked'));await page.waitForFunction(()=>!document.querySelector('#navigationToggle').disabled);
  await toggle.click();const bounds=await nav.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await nav.locator('.tab').evaluateAll(ns=>ns.every(n=>n.getBoundingClientRect().height>=44)));await page.screenshot({path:`/tmp/transaction003-navigation-${width}.png`,fullPage:true});await page.keyboard.press('Escape');
  await page.setViewportSize({width,height:320});await toggle.focus();await page.keyboard.press('Enter');const activeBounds=await nav.locator('[aria-current=page]').boundingBox(),panelBounds=await nav.boundingBox();assert(activeBounds.y>=panelBounds.y&&activeBounds.y+activeBounds.height<=panelBounds.y+panelBounds.height,'Focused current section must scroll into view in a short menu');await page.keyboard.press('Escape');
  assert(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);return ids.length===new Set(ids).size}));assert.deepEqual(await page.evaluate(()=>({ledger:JSON.stringify(LedgerApp.get()),storage:JSON.stringify({...localStorage})})),before);assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: header navigation order/unique IDs, open/select/current/close, keyboard and focus, outside click, touch, 320/390/1280px, retained month/filter, existing dialog controls, Settings shortcut, busy/cloud locks, unchanged ledger/storage.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}

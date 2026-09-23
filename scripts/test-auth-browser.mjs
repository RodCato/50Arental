// Real supabase-js and app UI; disposable profile and synthetic HTTP responses only.
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {fromCloud} from '../cloud/ledger-model.mjs';
import {baselineFixture} from '../tests/cloud-fixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const snapshot=await baselineFixture(),owner=snapshot.owner;
snapshot.state=fromCloud(snapshot,owner);
const profile=await mkdtemp(join(tmpdir(),'50a-auth-'));
const api='https://synthetic-auth.example.test';
const user=id=>({id,aud:'authenticated',role:'authenticated',email:'synthetic@example.test'});
const token=(id,expiry)=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,exp:expiry,role:'authenticated'})).toString('base64url'),'synthetic'].join('.');
const session=(id=owner,expiry=Math.floor(Date.now()/1000)+3600)=>({access_token:token(id,expiry),refresh_token:'synthetic-refresh-only',expires_at:expiry,expires_in:3600,token_type:'bearer',user:user(id)});
let refreshes=0,emails=0,writes=0,logouts=0,context,denyUser=false,userDelay=0;
const errors=[];
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path.includes('..'))throw Error();if(path==='/cloud-config.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled:true,url:api,publishableKey:'sb_publishable_SYNTHETIC'}));return;}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile('dist'+(path==='/'?'/index.html':path)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
async function launch(){context=await chromium.launchPersistentContext(profile,{headless:true,serviceWorkers:'block',...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin===origin)return route.continue();if(url.origin!==api)return route.abort();let body;
if(url.pathname==='/auth/v1/user'){if(userDelay)await new Promise(r=>setTimeout(r,userDelay));if(denyUser)return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({msg:'Synthetic invalid session'})});const bearer=req.headers().authorization?.split(' ')[1];const id=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url')).sub;body=user(id);}
else if(url.pathname==='/auth/v1/token'){refreshes++;body=session();}
else if(url.pathname==='/auth/v1/logout'){assert.equal(url.searchParams.get('scope'),'local');logouts++;return route.fulfill({status:204});}
else if(url.pathname==='/auth/v1/otp'){emails++;body={};}
else if(url.pathname==='/rest/v1/rpc/ledger_read')body=snapshot;
else {writes++;return route.abort();}
return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});return context.newPage();}
async function unlocked(p){await p.waitForFunction(()=>window.CloudLedger?.active()&&!document.body.classList.contains('cloud-locked'));await p.waitForFunction(()=>document.querySelector('#cloudLedgerControls').textContent.includes('Cloud connected'));assert.equal(await p.locator('#recurringHousing').textContent(),'$1,119.00');}
try{
let page=await launch();await page.goto(origin);await page.waitForFunction(()=>window.CloudLedger);
await page.evaluate(({snapshot,session})=>{localStorage.setItem('50a-data-mode',JSON.stringify({mode:'cloud',owner:snapshot.owner,recoveryId:'synthetic-recovery'}));localStorage.setItem('50a-cloud:'+snapshot.owner,JSON.stringify({owner:snapshot.owner,confirmed:snapshot,draft:snapshot.state,draftRows:snapshot.rows,queue:[],recoveryId:'synthetic-recovery'}));sessionStorage.setItem('50a-supabase-auth',JSON.stringify(session));},{snapshot,session:session()});
// Old tab-only credentials are not silently migrated.
await page.reload();await page.waitForFunction(()=>window.CloudLedger);assert.equal(await page.evaluate(()=>localStorage.getItem('50a-supabase-auth')),null);assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('cloud-locked')),true);
const s=session();await page.goto(origin+'/?callback=1#'+new URLSearchParams({access_token:s.access_token,refresh_token:s.refresh_token,expires_in:'3600',token_type:'bearer',type:'magiclink'}));await unlocked(page);assert.equal(new URL(page.url()).hash,'');
await page.reload();await unlocked(page);console.log('PASS: Magic Link callback and reload');
await page.close();page=await context.newPage();await page.goto(origin);await unlocked(page);console.log('PASS: tab/window close and reopen');
await context.close();page=await launch();userDelay=1000;await page.goto(origin);await page.waitForFunction(()=>window.LedgerApp);assert.equal(await page.evaluate(()=>window.LedgerApp.get().transactions.length),0);await unlocked(page);userDelay=0;console.log('PASS: persistent browser/PWA-equivalent restart; cache hidden during identity verification');
await page.evaluate(s=>localStorage.setItem('50a-supabase-auth',JSON.stringify(s)),session(owner,Math.floor(Date.now()/1000)-60));await page.reload();await unlocked(page);assert.ok(refreshes>0);assert.equal(emails,0);console.log('PASS: expired access-token restoration via SDK refresh without email');
const exported=await page.evaluate(async()=>JSON.stringify(await BackupUtils.create(window.LedgerApp.get(),()=>null)));assert.ok(!exported.includes('synthetic-refresh-only'));assert.ok(!exported.includes('access_token'));const google=await page.evaluate(()=>JSON.stringify(buildSyncPayload()));assert.ok(!google.includes('synthetic-refresh-only'));assert.ok(!google.includes('access_token'));
await page.locator('[data-tab="settings"]').click();await page.locator('#cloudSignOut').click();await page.waitForFunction(()=>document.body.classList.contains('cloud-locked')&&!localStorage.getItem('50a-supabase-auth'));assert.equal(logouts,1);
await context.close();page=await launch();await page.goto(origin);await page.waitForFunction(()=>window.CloudLedger);assert.equal(await page.evaluate(()=>localStorage.getItem('50a-supabase-auth')),null);assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('cloud-locked')),true);console.log('PASS: local sign-out survives restart');
await page.evaluate(s=>localStorage.setItem('50a-supabase-auth',JSON.stringify(s)),session('bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'));await page.reload();await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('Signed in'));assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('cloud-locked')),true);assert.equal(await page.evaluate(()=>window.LedgerApp.get().transactions.length),0);assert.equal(await page.evaluate(owner=>JSON.parse(localStorage.getItem('50a-cloud:'+owner)).recoveryId,owner),'synthetic-recovery');
denyUser=true;await page.evaluate(s=>localStorage.setItem('50a-supabase-auth',JSON.stringify(s)),session());await page.reload();await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('signed out'));assert.equal(await page.evaluate(()=>window.LedgerApp.get().transactions.length),0);console.log('PASS: invalid persisted session cannot unlock cached ledger');
assert.equal(writes,0);assert.equal(emails,0);assert.deepEqual(errors,[]);console.log('PASS: owner isolation, preserved recovery/cache, backup separation, zero business writes or email requests');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}

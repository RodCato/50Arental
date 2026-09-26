import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import vm from 'node:vm';
import {publicConfig} from '../scripts/public-config.mjs';
import Backup from '../backup-utils.js';
import fixtures from './backup-fixture.cjs';
const canary='synthetic-server-secret-not-for-browser-4a';
test('browser bundle and public config exclude server SDK/key/model config; portable backup excludes OCR and server environment',async()=>{
 const bundle=(await build({entryPoints:['cloud/ui.mjs'],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0].text;
 for(const forbidden of ['OPENAI_API_KEY','OPENAI_RECEIPT_MODEL',canary,'api.openai.com','/v1/responses'])assert(!bundle.includes(forbidden),`Browser contains ${forbidden}`);
 const config=publicConfig({SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',OPENAI_API_KEY:canary,OPENAI_RECEIPT_MODEL:'server-model'});assert(!JSON.stringify(config).includes(canary));assert.deepEqual(Object.keys(config),['enabled','url','publishableKey']);
 const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY=canary;
 try{const f=fixtures.fixture(),backup=await Backup.create(f.state,f.get);await Backup.validate(backup);const text=JSON.stringify(backup);for(const forbidden of [canary,'OPENAI_API_KEY','overall_confidence','extraction'])assert(!text.includes(forbidden));}finally{if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior;}
});
test('service worker ignores receipt API, private evidence, Supabase auth and responses',async()=>{
 const listeners={};vm.runInNewContext(await readFile('sw.js','utf8'),{self:{location:{origin:'https://example.test',href:'https://example.test/sw.js'},addEventListener:(event,handler)=>listeners[event]=handler},URL});
 for(const [method,url] of [['POST','https://example.test/api/receipt-ocr'],['GET','https://example.test/api/receipt-ocr'],['GET','https://synthetic.supabase.co/storage/v1/object/private'],['GET','https://synthetic.supabase.co/auth/v1/user'],['GET','https://api.openai.com/v1/responses']])listeners.fetch({request:{method,url},respondWith:()=>assert.fail('Private request intercepted by shell cache')});
});

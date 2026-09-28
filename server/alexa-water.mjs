import {createHash,timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {missing} from '../cloud/contract.mjs';
import {reply} from './receipt-http.mjs';

// UUIDv5 namespaces are fixed protocol constants, NOT credentials. Never change v1.
export const EVENT_NAMESPACE='e7ae804e-e367-51c8-a4ac-d3939c982071';
export const OP_NAMESPACE='57b5e84c-d718-5a36-830d-273daac218a0';
export const VOICE_CONTRACT={contract_version:2,domains:['water_events'],features:['alexa_water_v1'],read_versions:[2]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reject=(status,code)=>{throw Object.assign(Error(code),{safe:true,status,code})};
export function uuidV5(namespace,name){
 const bytes=createHash('sha1').update(Buffer.from(namespace.replaceAll('-',''),'hex')).update(name,'utf8').digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;
 const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function identity(body,now=Date.now()){
 if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length!==2||!Object.hasOwn(body,'request_id')||!Object.hasOwn(body,'request_timestamp'))reject(400,'invalid_request');
 if(typeof body.request_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,193}$/.test(body.request_id))reject(400,'invalid_request');
 const t=body.request_timestamp;
 if(typeof t!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(t))reject(400,'invalid_timestamp');
 const ms=Date.parse(t);if(!Number.isFinite(ms))reject(400,'invalid_timestamp');
 const canonical=new Date(ms).toISOString();
 // Old exact replays remain possible. The database permits new requests only within 5 min.
 if(canonical!==t.replace(/(?<=:\d{2})Z$/,'.000Z')||ms<Date.UTC(2020,0,1)||ms>now+60000)reject(400,'invalid_timestamp');
 return {event:uuidV5(EVENT_NAMESPACE,`alexa:${body.request_id}`),operation:uuidV5(OP_NAMESPACE,`alexa:${body.request_id}`),timestamp:canonical};
}
function config(env){
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(env.FIFTY_A_VOICE_TOKEN||'')||!uuid.test(env.FIFTY_A_VOICE_OWNER_ID||'')||!env.SUPABASE_SERVICE_ROLE_KEY)reject(503,'configuration');
 let url;try{url=new URL(env.SUPABASE_URL)}catch{reject(503,'configuration')}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)reject(503,'configuration');
 return {owner:env.FIFTY_A_VOICE_OWNER_ID.toLowerCase(),url:url.origin,key:env.SUPABASE_SERVICE_ROLE_KEY,token:env.FIFTY_A_VOICE_TOKEN};
}
export function createHandler({env=process.env,clientFactory=createClient,now=Date.now,timeoutMs=4800}={}){
 return async(req,res)=>{
  try{
   if(req.method!=='POST'){res.setHeader('Allow','POST');reject(405,'method_not_allowed')}
   const cfg=config(env),auth=req.headers?.authorization;
   if(typeof auth!=='string'||auth.length>256||!timingSafeEqual(createHash('sha256').update(auth).digest(),createHash('sha256').update(`Bearer ${cfg.token}`).digest()))reject(401,'unauthorized');
   if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))reject(415,'content_type');
   let body=req.body;
   if(typeof body==='string'){if(Buffer.byteLength(body)>1024)reject(413,'request_too_large');try{body=JSON.parse(body)}catch{reject(400,'invalid_request')}}
   if(Buffer.byteLength(JSON.stringify(body)||'')>1024)reject(413,'request_too_large');
   const id=identity(body,now());
   const signal=AbortSignal.timeout(timeoutMs);
   const client=clientFactory(cfg.url,cfg.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal,redirect:'error'})}});
   const user=await client.auth.admin.getUserById(cfg.owner);
   if(user.error||user.data?.user?.id!==cfg.owner||!user.data.user.email_confirmed_at||user.data.user.deleted_at||Date.parse(user.data.user.banned_until)>now())reject(503,'owner_unavailable');
   const caps=await client.rpc('ledger_capabilities');
   if(caps.error||missing(caps.data,VOICE_CONTRACT).length)reject(503,'backend_incompatible');
   const args={p_owner:cfg.owner,p_event:id.event,p_operation:id.operation,p_completed_at:id.timestamp};
   let result;
   for(let attempt=0;attempt<2;attempt++){
    result=await client.rpc('alexa_log_water',args);
    if(result.error?.code!=='40001'||attempt===1)break;
   }
   if(result.error){
    if(result.error.code==='P0429')reject(429,'rate_limited');
    if(result.error.code==='22023')reject(409,'identity_or_timestamp_rejected');
    if(['42883','PGRST202','0A000'].includes(result.error.code))reject(503,'backend_incompatible');
    reject(502,'unconfirmed');
   }
   if(typeof result.data?.replayed!=='boolean')reject(502,'unconfirmed');
   return reply(res,200,{ok:true,request_id:body.request_id,duplicate:result.data.replayed});
  }catch(e){return reply(res,e.safe?e.status:502,{ok:false,error:e.safe?e.code:'unconfirmed'})}
 };
}

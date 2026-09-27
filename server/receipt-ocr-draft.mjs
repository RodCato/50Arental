import {createClient} from '@supabase/supabase-js';
import sharp from 'sharp';
import {publicConfig} from '../scripts/public-config.mjs';
import {analyzeReceipt} from './receipt-analysis.mjs';
import {fail,reply,replyError} from './receipt-http.mjs';
export const DRAFT_BYTES=4*1024*1024,REQUEST_BYTES=DRAFT_BYTES+65536;
const formats={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
// Process-local guard: bounds concurrent cost, not a distributed/global quota.
export function createDraftHandler({env=process.env,makeSupabase=createClient,analyze=analyzeReceipt,now=Date.now}={}){
 const users=new Map();
 return async(req,res)=>{
  let stage='input',release;
  try{
   if(req.method!=='POST'){res.setHeader('Allow','POST');fail(405,'method','Use POST.');}
   let origin;try{origin=new URL(req.headers.origin)}catch{fail(403,'origin','Use receipt analysis from this application.');}
   if(origin.host!==req.headers.host||!['https:','http:'].includes(origin.protocol)||origin.origin!==req.headers.origin||req.headers['sec-fetch-site']==='cross-site'||(origin.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))fail(403,'origin','Use receipt analysis from this application.');
   const length=req.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>REQUEST_BYTES))fail(413,'size','Draft receipt request exceeds the 4 MiB image limit.');
   const type=req.headers['content-type']||'';if(!/^multipart\/form-data;\s*boundary=/i.test(type))fail(415,'input','Send receipt images as multipart form data.');
   stage='auth';const auth=req.headers.authorization;if(typeof auth!=='string'||!/^Bearer \S+$/.test(auth)||auth.length>8192)fail(401,'unauthenticated','Sign in to analyze receipts.');
   let config;try{config=publicConfig(env)}catch{fail(503,'configuration','Receipt analysis is not configured.');}if(!config.enabled)fail(503,'configuration','Receipt analysis is not configured.');
   const deadline=AbortSignal.timeout(55000);
   const client=makeSupabase(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:auth},fetch:(url,opts={})=>fetch(url,{...opts,signal:AbortSignal.any([deadline,AbortSignal.timeout(10000),...(opts.signal?[opts.signal]:[])])})}});
   const {data,error}=await client.auth.getUser(auth.slice(7)),user=data?.user;
   if(error||!user||user.is_anonymous||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(user.id||''))fail(401,'unauthenticated','Session invalid or expired. Sign in again.');
   stage='input';const time=now();for(const [key,value] of users)if(!value.active&&time-value.start>=60000)users.delete(key);
   const guard=users.get(user.id)||{start:time,count:0,active:false};if(guard.active||guard.count>=3||users.size>=1000&&!users.has(user.id))fail(429,'rate_limit','Analysis is rate limited. Wait before pressing Retry.');guard.active=true;guard.count++;users.set(user.id,guard);release=()=>{guard.active=false};
   const chunks=[];let size=0;
   // Do not access req.body: consume bounded raw multipart bytes, never text-decode images.
   for await(const chunk of req){size+=chunk.length;if(size>REQUEST_BYTES)fail(413,'size','Draft receipt request exceeds the 4 MiB image limit.');chunks.push(chunk);}
   let form;try{form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':type},body:Buffer.concat(chunks)}).formData()}catch{fail(400,'input','Invalid image upload.');}
   const entries=[...form.entries()];if(!entries.length||entries.length>4||entries.some(([key,file])=>key!=='images'||typeof file==='string'))fail(400,'input','Send only 1–4 receipt images.');
   const images=[];let total=0;
   for(const [,file] of entries){
    if(!formats[file.type])fail(415,'mime','Only JPEG, PNG and WebP receipt images are supported.');
    if(!file.size||file.size>DRAFT_BYTES||(total+=file.size)>DRAFT_BYTES)fail(413,'size','Choose images totaling no more than 4 MiB after compression.');
    const bytes=Buffer.from(await file.arrayBuffer());
    try{const image=sharp(bytes,{failOn:'warning',limitInputPixels:2560000,animated:false});const meta=await image.metadata();if(meta.format!==formats[file.type]||!meta.width||!meta.height||meta.width>1600||meta.height>1600||(meta.pages||1)!==1)throw Error();await image.raw().toBuffer();}catch{fail(415,'mime','A receipt image is damaged, unsupported, or exceeds normalized image dimensions.');}
    images.push({type:'input_image',image_url:`data:${file.type};base64,${bytes.toString('base64')}`,detail:'high'});
   }
   stage='openai';reply(res,200,await analyze(images,{env,deadline}));
  }catch(error){replyError(res,error,stage)}finally{release?.()}
 };
}

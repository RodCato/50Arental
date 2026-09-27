import OpenAI from 'openai';
import {createClient} from '@supabase/supabase-js';
import {publicConfig} from '../scripts/public-config.mjs';
import {analyzeReceipt,DEFAULT_MODEL} from './receipt-analysis.mjs';
export {DEFAULT_MODEL};
export const MAX_IMAGES=4,MAX_BYTES=20*1024*1024;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {fail,reply,replyError} from './receipt-http.mjs';
function imageMatches(bytes,mime){
 if(mime==='image/png')return bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217;
 return mime==='image/webp'&&bytes.length>=16&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
}
// Dependencies can be replaced with synthetic transports; production never uses a service-role key.
export function createReceiptHandler({env=process.env,makeSupabase=createClient,makeOpenAI=options=>new OpenAI(options),fetcher=fetch}={}){
 return async(req,res)=>{
  let stage='auth';
  try{
   if(req.method!=='POST'){res.setHeader('Allow','POST');fail(405,'method','Use POST.');}
   const auth=req.headers.authorization;if(typeof auth!=='string'||!/^Bearer \S+$/.test(auth)||auth.length>8192)fail(401,'unauthenticated','Sign in to analyze a saved receipt.');
   const token=auth.slice(7);let config;try{config=publicConfig(env)}catch{fail(503,'configuration','Receipt analysis is not configured.');}if(!config.enabled)fail(503,'configuration','Receipt analysis is not configured.');
   const deadline=AbortSignal.timeout(55000);
   const boundedFetch=(url,options={})=>fetcher(url,{...options,signal:AbortSignal.any([deadline,AbortSignal.timeout(10000),...(options.signal?[options.signal]:[])])});
   const supabase=makeSupabase(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:auth},fetch:boundedFetch}});
   const identity=await supabase.auth.getUser(token);const user=identity.data?.user;
   if(identity.error||!user||!uuid.test(user.id)||user.is_anonymous)fail(401,'unauthenticated','Session invalid or expired. Sign in again.');
   stage='input';if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))fail(415,'input','Send attachment IDs as JSON.');
   if(Number(req.headers['content-length']||0)>2048)fail(413,'input','Request too large.');
   let body=req.body;if(typeof body==='string'){if(Buffer.byteLength(body)>2048)fail(413,'input','Request too large.');try{body=JSON.parse(body)}catch{fail(400,'input','Invalid request.');}}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Array.isArray(body.attachment_ids))fail(400,'input','Only attachment_ids are accepted.');
   const ids=body.attachment_ids;if(!ids.length||ids.length>MAX_IMAGES||ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids).size!==ids.length)fail(400,'input',`Choose 1–${MAX_IMAGES} distinct saved receipt images.`);
   stage='evidence';
   const found=await supabase.from('attachments').select('id,owner_id,transaction_id,property_condition_id,attachment_type,storage_bucket,storage_path,mime_type,size_bytes').in('id',ids).eq('owner_id',user.id);
   if(found.error)fail(502,'evidence','Receipt metadata could not be read. Retry when connected.');
   if(!Array.isArray(found.data)||found.data.length!==ids.length)fail(404,'unavailable','One or more receipt images are unavailable to this account.');
   const rows=ids.map(id=>found.data.find(a=>a.id===id));let total=0;
   for(const a of rows){
    if(!a||a.owner_id!==user.id||a.attachment_type!=='receipt'||a.property_condition_id!==null||!uuid.test(a.transaction_id||'')||a.storage_bucket!=='50a-evidence'||!new RegExp('^'+user.id+'/receipts/'+a.id+'\\.(webp|jpg|jpeg|png)$').test(a.storage_path||''))fail(404,'unavailable','One or more receipt images are unavailable to this account.');
    if(!['image/jpeg','image/png','image/webp'].includes(a.mime_type))fail(415,'mime','Only JPEG, PNG and WebP receipt images are supported.');
    if(!Number.isSafeInteger(a.size_bytes)||a.size_bytes<=0||a.size_bytes>MAX_BYTES||(total+=a.size_bytes)>MAX_BYTES)fail(413,'size','Selected receipt images exceed the 20 MiB combined limit.');
   }
   if(new Set(rows.map(a=>a.transaction_id)).size!==1)fail(400,'mixed_receipts','Choose images from the same saved transaction only.');
   const parent=await supabase.from('transactions').select('id,owner_id').eq('id',rows[0].transaction_id).eq('owner_id',user.id).maybeSingle();
   if(parent.error||!parent.data||parent.data.owner_id!==user.id||parent.data.id!==rows[0].transaction_id)fail(404,'unavailable','Receipt parent is unavailable to this account.');
   if(!env.OPENAI_API_KEY)fail(503,'configuration','Receipt analysis is not configured.');
   const images=[];
   for(const row of rows){const {data,error}=await supabase.storage.from('50a-evidence').download(row.storage_path);if(error||!data||data.size!==row.size_bytes||data.type.split(';')[0]!==row.mime_type)fail(502,'download','A receipt image could not be downloaded completely. Nothing was analyzed.');const bytes=Buffer.from(await data.arrayBuffer());if(!imageMatches(bytes,row.mime_type))fail(415,'mime','A receipt image has an unsupported or damaged format.');images.push({type:'input_image',image_url:`data:${row.mime_type};base64,${bytes.toString('base64')}`,detail:'high'});}
   stage='openai';reply(res,200,await analyzeReceipt(images,{env,makeOpenAI,deadline}));
  }catch(error){
   replyError(res,error,stage);
  }
 };
}

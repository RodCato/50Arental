export class SafeError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code})}}
export const fail=(status,code,message)=>{throw new SafeError(status,code,message)};
export const reply=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Vercel-CDN-Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body));};

export function replyError(res,error,stage){
   if(error instanceof SafeError)return reply(res,error.status,{error:{code:error.code,message:error.message}});
   if(error?.name==='TimeoutError'||error?.name==='AbortError'||error?.name==='APIConnectionTimeoutError'||error?.name==='APIUserAbortError')return reply(res,504,{error:{code:'timeout',message:'Analysis timed out. Retry explicitly; a timed-out request may still incur usage.'}});
   if(stage==='auth')return reply(res,401,{error:{code:'unauthenticated',message:'Session could not be verified. Sign in again.'}});
   if(stage==='openai'){
    if(error?.status===429)return reply(res,429,{error:{code:error.code==='insufficient_quota'?'credits':'rate_limit',message:error.code==='insufficient_quota'?'API credits or quota are unavailable. Check the OpenAI account before retrying.':'Analysis is rate limited. Wait before pressing Retry.'}});
    if([401,403,404].includes(error?.status))return reply(res,503,{error:{code:'provider_configuration',message:'The analysis key or model is unavailable. Check server configuration.'}});
   }
   reply(res,502,{error:{code:'unavailable',message:'Receipt analysis is unavailable. No ledger data was changed.'}});
}

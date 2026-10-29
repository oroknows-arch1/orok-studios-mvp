import {createServer} from 'node:http';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {OWNER_SESSION_TTL_MS} from './owner-sessions.js';
import {ReviewWorkflow} from './review-workflow.js';
import {reviewPage} from './review-page.js';

const json=(res,status,payload)=>{
 const body=JSON.stringify(payload);
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; frame-ancestors 'none'"});
 res.end(body);
};
// Never log request URLs, bodies, credentials, arbitrary errors or identifiers
// derived from OAuth state/session data. References are fresh random UUIDs.
const OAUTH_STAGES=new Set(['REQUEST','REQUEST_BODY','STATE_LOOKUP','SESSION_COOKIE','CSRF','OWNER_SESSION','OWNER_BINDING','CONFIGURATION','DATABASE_LOCK','STATE_CONSUME','STATE_DECRYPT','CALLBACK_INPUT','TOKEN_EXCHANGE','TOKEN_REQUIREMENTS','ACCOUNT_VERIFICATION','TOKEN_PERSISTENCE']);
const OAUTH_REASONS=new Set(['ACCESS_DENIED','CSRF_DENIED','ORIGIN_DENIED','X_CONNECTION_UNAVAILABLE','OWNER_SESSION_REQUIRED','V3_X_ACCOUNT_CONFIG_REQUIRED','V3_X_OAUTH_CONFIG_REQUIRED','V3_X_ENCRYPTION_KEY_REQUIRED','V3_X_OAUTH_STATE_INVALID','V3_X_DECRYPTION_FAILED','V3_X_OAUTH_DENIED','V3_X_OAUTH_CODE_INVALID','V3_X_TOKEN_EXCHANGE_UNCONFIRMED','V3_X_REFRESH_TOKEN_REQUIRED','V3_X_SCOPES_REQUIRED','V3_X_ACCOUNT_VERIFICATION_FAILED','V3_X_ACCOUNT_MISMATCH','V3_X_REFRESH_LOCK_REQUIRED']);
const OAUTH_PROVIDER_ERRORS=new Set(['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','access_denied','server_error','temporarily_unavailable']);
function oauthDiagnostic(stage,error,status,log){
 const result={event:'V3_X_OAUTH_CALLBACK_FAILURE',stage:OAUTH_STAGES.has(error?.oauthStage)?error.oauthStage:OAUTH_STAGES.has(stage)?stage:'REQUEST',reason:OAUTH_REASONS.has(error?.message)?error.message:'INTERNAL_FAILURE',status,diagnostic_id:randomUUID()};
 if(Number.isInteger(error?.oauthProviderStatus)&&error.oauthProviderStatus>=100&&error.oauthProviderStatus<=599)result.provider_status=error.oauthProviderStatus;
 if(OAUTH_PROVIDER_ERRORS.has(error?.oauthProviderError))result.provider_error=error.oauthProviderError;
 log('V3_X_OAUTH_CALLBACK_FAILURE '+JSON.stringify(result));
 return {stage:result.stage,diagnostic_id:result.diagnostic_id};
}
const sessionCookie=campaignId=>'emradar_v3_session_'+createHash('sha256').update(String(campaignId)).digest('hex').slice(0,16);
const cookie=(req,name)=>{
 const found=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
 return found?decodeURIComponent(found.slice(name.length+1)):null;
};
async function body(req) {
 let value='';
 for await(const chunk of req){
  value+=chunk.toString('utf8');
  if(value.length>65536) throw Error('REQUEST_TOO_LARGE');
 }
 return JSON.parse(value||'{}');
}
export function createReviewServer({workflow,runDiscovery,runRegeneration,releaseEmail,xAuth,publishing={email:{enabled:true},x:{enabled:false,reason:'X publishing is disabled.'}},logOAuthDiagnostic=message=>console.info(message),health=()=>({ok:true})}) {
 if(!(workflow instanceof ReviewWorkflow)) throw Error('WORKFLOW_REQUIRED');
 return createServer(async(req,res)=>{
  let isCallback=false,stage='REQUEST',failure;
  const reply=(status,payload)=>{
   if(isCallback&&status>=400){
    const diagnostic=oauthDiagnostic(stage,failure||new Error(payload.error),status,logOAuthDiagnostic);
    return json(res,status,{...payload,oauth_stage:diagnostic.stage,diagnostic_id:diagnostic.diagnostic_id});
   }
   return json(res,status,payload);
  };
  try {
   const url=new URL(req.url,'http://localhost');
   if(req.method==='GET' && url.pathname==='/health') return json(res,200,health());
   if(req.method==='GET' && url.pathname==='/review/access') {
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; frame-src 'self' about:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
    return res.end(reviewPage);
   }
   if(req.method==='GET' && url.pathname==='/api/review/x/callback'){
    // A same-origin POST restores Strict session-cookie delivery after the
    // cross-site redirect. No code/state is interpolated into HTML or logged.
    const nonce=randomBytes(24).toString('base64');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
    return res.end('<!doctype html><meta name="referrer" content="no-referrer"><title>Connect X</title><p id="status">Completing your X connection…</p><script nonce="'+nonce+'">(async()=>{const query=new URLSearchParams(location.search);const input={state:query.get("state"),code:query.get("code"),error:query.get("error")};history.replaceState(null,"",location.pathname);const csrf=decodeURIComponent((document.cookie.split("; ").find(x=>x.startsWith("emradar_v3_csrf="))||"").split("=").slice(1).join("="));try{const r=await fetch("/api/review/x/callback",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-emradar-csrf":csrf},body:JSON.stringify(input)});const result=await r.json();if(!r.ok){const stage=/^[A-Z_]+$/.test(result.oauth_stage||"")?result.oauth_stage:"CALLBACK_REQUEST";const ref=/^[0-9a-f-]{36}$/.test(result.diagnostic_id||"")?result.diagnostic_id:"unavailable";document.getElementById("status").textContent="X connection failed at "+stage+". Reference: "+ref+". Nothing was published.";return;}location.replace(result.review_url);}catch{document.getElementById("status").textContent="X callback request could not complete. Nothing was published. Reopen your private review in this browser.";}})();</script>');
   }
   if(req.method!=='POST') return json(res,404,{error:'NOT_FOUND'});
   if(!['/api/review/thread-present','/api/review/request-access','/api/review/exchange','/api/review/view','/api/review/decision','/api/review/group','/api/review/group-revise','/api/review/group-member','/api/review/revise','/api/review/discover','/api/review/release','/api/review/x/connect','/api/review/x/callback','/api/review/x/status'].includes(url.pathname)) return json(res,404,{error:'NOT_FOUND'});
   isCallback=url.pathname==='/api/review/x/callback';
   if(req.headers.origin && req.headers.origin!==workflow.baseUrl) return reply(403,{error:'ORIGIN_DENIED'});
   stage='REQUEST_BODY';
   const input=await body(req);
   if(url.pathname==='/api/review/request-access'){
    if(req.headers.origin!==workflow.baseUrl)return reply(403,{error:'ORIGIN_DENIED'});
    const oldCookie=cookie(req,sessionCookie(input.campaignId))||cookie(req,'emradar_v3_session')||'';const dot=oldCookie.indexOf('.');
    return json(res,200,await workflow.requestAccess(input.campaignId,{token:input.token,sessionId:dot>0?oldCookie.slice(0,dot):null,sessionSecret:dot>0?oldCookie.slice(dot+1):null}));
   }
   if(url.pathname==='/api/review/exchange'){
    const session=await workflow.exchange(input.campaignId,input.token);
    const csrf=randomBytes(24).toString('hex');
    res.setHeader('set-cookie',[
     sessionCookie(input.campaignId)+'='+encodeURIComponent(session.sessionId+'.'+session.secret)+'; HttpOnly; Secure; SameSite=Strict; Path=/api/review; Max-Age='+Math.floor(OWNER_SESSION_TTL_MS/1000),
     'emradar_v3_csrf='+encodeURIComponent(csrf)+'; Secure; SameSite=Strict; Path=/; Max-Age='+Math.floor(OWNER_SESSION_TTL_MS/1000)
    ]);
    return json(res,200,{expiresAt:session.expiresAt});
   }
   let oauthContext;
   if(url.pathname==='/api/review/x/callback'){
    stage='STATE_LOOKUP';
    if(!xAuth)return reply(503,{error:'X_CONNECTION_UNAVAILABLE'});
    oauthContext=await xAuth.context(input.state);
    input.campaignId=oauthContext.campaign_id;
   }
   stage='SESSION_COOKIE';
   const value=cookie(req,sessionCookie(input.campaignId))||cookie(req,'emradar_v3_session');
   if(!value) return reply(403,{error:'ACCESS_DENIED'});
   const separator=value.indexOf('.');
   if(separator<1) return reply(403,{error:'ACCESS_DENIED'});
   const session={id:value.slice(0,separator),secret:value.slice(separator+1)};
   if(url.pathname==='/api/review/view'){
    const view=await workflow.view(input.campaignId,session.id,session.secret);
    await workflow.renewSession(input.campaignId,session.id,session.secret);
    res.setHeader('set-cookie',[
     sessionCookie(input.campaignId)+'='+encodeURIComponent(session.id+'.'+session.secret)+'; HttpOnly; Secure; SameSite=Strict; Path=/api/review; Max-Age='+Math.floor(OWNER_SESSION_TTL_MS/1000),
     'emradar_v3_csrf='+randomBytes(24).toString('hex')+'; Secure; SameSite=Strict; Path=/; Max-Age='+Math.floor(OWNER_SESSION_TTL_MS/1000)
    ]);
    return json(res,200,{...view,publishing});
   }
   stage='CSRF';
   const csrf=cookie(req,'emradar_v3_csrf');
   if(!csrf || req.headers['x-emradar-csrf']!==csrf) return reply(403,{error:'CSRF_DENIED'});
   if(url.pathname==='/api/review/thread-present'){
    await workflow.authenticate(input.campaignId,session.id,session.secret);
    if(!workflow.audienceThread)return json(res,503,{error:'THREAD_REVIEW_UNAVAILABLE'});
    await workflow.audienceThread.present(input.campaignId,session.id,input);
    return json(res,200,{presented:true});
   }
   if(url.pathname.startsWith('/api/review/x/')){
    if(!xAuth)return reply(503,{error:'X_CONNECTION_UNAVAILABLE'});
    if(req.headers.origin!==workflow.baseUrl)return reply(403,{error:'ORIGIN_DENIED'});
    stage='OWNER_SESSION';
    await workflow.authenticate(input.campaignId,session.id,session.secret);
    if(url.pathname==='/api/review/x/connect')return json(res,200,await xAuth.start({campaignId:input.campaignId,sessionId:session.id}));
    if(url.pathname==='/api/review/x/status')return json(res,200,{status:'CONNECTED',...await xAuth.verifyAccount(await xAuth.current({allowRefresh:true}))});
    stage='OWNER_BINDING';
    if(oauthContext.session_id!==session.id)return reply(403,{error:'ACCESS_DENIED'});
    return json(res,200,await xAuth.complete({state:input.state,code:input.code,error:input.error,campaignId:input.campaignId,sessionId:session.id}));
   }
   if(url.pathname==='/api/review/release'){
    if(typeof releaseEmail!=='function')return json(res,503,{error:'RELEASE_UNAVAILABLE'});
    await workflow.authenticate(input.campaignId,session.id,session.secret);
    return json(res,200,await releaseEmail({campaignId:input.campaignId,destinationId:input.destinationId,sessionId:session.id,sessionSecret:session.secret}));
   }
   if(url.pathname==='/api/review/discover'){
    if(typeof runDiscovery!=='function')return json(res,503,{error:'DISCOVERY_UNAVAILABLE'});
    await workflow.authenticate(input.campaignId,session.id,session.secret);
    return json(res,200,await runDiscovery(input.campaignId));
   }
   if(url.pathname==='/api/review/decision'){
    const state=await workflow.decide(input.campaignId,session.id,session.secret,input.destinationId,input.decision,input.fingerprint,input.feedback??'');
    const action=state?.review_actions?.[input.destinationId];
    if(action?.status==='PENDING'&&typeof runRegeneration==='function')setImmediate(()=>runRegeneration(input.campaignId,input.destinationId).catch(error=>console.error('V3_REGENERATION_WORKER_FAILED',/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'V3_REGENERATION_FAILED')));
    return json(res,200,{saved:true,regeneration_status:action?.status??null});
   }
   if(url.pathname==='/api/review/revise'){
    return json(res,200,await workflow.revise(input.campaignId,session.id,session.secret,input.destinationId,input.fingerprint,input.changes));
   }
   if(url.pathname==='/api/review/group'){
    await workflow.decideGroup(input.campaignId,session.id,session.secret,input.groupId,input.decision,input.contentHash,input.version);
    return json(res,200,{saved:true});
   }
   if(url.pathname==='/api/review/group-revise'){
    await workflow.reviseGroup(input.campaignId,session.id,session.secret,input.groupId,input.contentHash,input.version,input.changes);
    return json(res,200,{saved:true});
   }
   if(url.pathname==='/api/review/group-member'){
    await workflow.removeFromGroup(input.campaignId,session.id,session.secret,input.groupId,input.destinationId,input.contentHash,input.version,input.action);
    return json(res,200,{saved:true});
   }
   return json(res,404,{error:'NOT_FOUND'});
  }catch(error){
   failure=error;
   const status=/ACCESS_DENIED|SESSION_REQUIRED|REVIEW_NOT_OPEN/.test(error.message)?403:400;
   return reply(status,{error:status===403?'ACCESS_DENIED':'INVALID_REQUEST'});
  }
 });
}

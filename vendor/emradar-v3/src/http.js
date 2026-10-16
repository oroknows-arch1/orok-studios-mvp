import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {ReviewWorkflow} from './review-workflow.js';
import {reviewPage} from './review-page.js';

const json=(res,status,payload)=>{
 const body=JSON.stringify(payload);
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; frame-ancestors 'none'"});
 res.end(body);
};
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
export function createReviewServer({workflow,runDiscovery,releaseEmail,health=()=>({ok:true})}) {
 if(!(workflow instanceof ReviewWorkflow)) throw Error('WORKFLOW_REQUIRED');
 return createServer(async(req,res)=>{
  try {
   const url=new URL(req.url,'http://localhost');
   if(req.method==='GET' && url.pathname==='/health') return json(res,200,health());
   if(req.method==='GET' && url.pathname==='/review/access') {
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src https://emerging-markets-radar.onrender.com; frame-src 'self' about:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
    return res.end(reviewPage);
   }
   if(req.method!=='POST') return json(res,404,{error:'NOT_FOUND'});
   if(!['/api/review/exchange','/api/review/view','/api/review/decision','/api/review/group','/api/review/revise','/api/review/discover','/api/review/release'].includes(url.pathname)) return json(res,404,{error:'NOT_FOUND'});
   if(req.headers.origin && req.headers.origin!==workflow.baseUrl) return json(res,403,{error:'ORIGIN_DENIED'});
   const input=await body(req);
   if(url.pathname==='/api/review/exchange'){
    const session=await workflow.exchange(input.campaignId,input.token);
    const csrf=randomBytes(24).toString('hex');
    res.setHeader('set-cookie',[
     'emradar_v3_session='+encodeURIComponent(session.sessionId+'.'+session.secret)+'; HttpOnly; Secure; SameSite=Strict; Path=/api/review; Max-Age=86400',
     'emradar_v3_csrf='+encodeURIComponent(csrf)+'; Secure; SameSite=Strict; Path=/; Max-Age=86400'
    ]);
    return json(res,200,{expiresAt:session.expiresAt});
   }
   const value=cookie(req,'emradar_v3_session');
   if(!value) return json(res,403,{error:'ACCESS_DENIED'});
   const separator=value.indexOf('.');
   if(separator<1) return json(res,403,{error:'ACCESS_DENIED'});
   const session={id:value.slice(0,separator),secret:value.slice(separator+1)};
   if(url.pathname==='/api/review/view') return json(res,200,await workflow.view(input.campaignId,session.id,session.secret));
   const csrf=cookie(req,'emradar_v3_csrf');
   if(!csrf || req.headers['x-emradar-csrf']!==csrf) return json(res,403,{error:'CSRF_DENIED'});
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
    await workflow.decide(input.campaignId,session.id,session.secret,input.destinationId,input.decision,input.fingerprint);
    return json(res,200,{saved:true});
   }
   if(url.pathname==='/api/review/revise'){
    await workflow.revise(input.campaignId,session.id,session.secret,input.destinationId,input.fingerprint,input.changes);
    return json(res,200,{saved:true});
   }
   if(url.pathname==='/api/review/group'){
    await workflow.decideGroup(input.campaignId,session.id,session.secret,input.groupKey,input.decision);
    return json(res,200,{saved:true});
   }
   return json(res,404,{error:'NOT_FOUND'});
  }catch(error){
   const status=/ACCESS_DENIED|SESSION_REQUIRED|REVIEW_NOT_OPEN/.test(error.message)?403:400;
   return json(res,status,{error:status===403?'ACCESS_DENIED':'INVALID_REQUEST'});
  }
 });
}

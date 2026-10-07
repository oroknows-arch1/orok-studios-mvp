"use strict";
// Owner-authorized, deployment-only authentication probe. No HTTP entry point.
// Hard expiry prevents later restarts from repeating this temporary diagnostic.
const EXPIRES_AT=Date.parse('2026-10-07T18:46:47Z');
let started=false;
function failure(e){
 if(e?.authenticationFailed||e?.code==='EAUTH')return 'AUTHENTICATION_REJECTED';
 if(e?.code==='ENOTFOUND'||e?.code==='EAI_AGAIN')return 'HOST_DNS_FAILED';
 if(e?.code==='ETIMEDOUT')return 'CONNECTION_TIMEOUT';
 if(e?.code==='ECONNREFUSED')return 'CONNECTION_REFUSED';
 if(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(e?.code))return 'TLS_CERTIFICATE_FAILED';
 return 'CONNECTION_OR_PROTOCOL_FAILED';
}
async function runAuthenticationProbe({env=process.env,now=Date.now,createTransport,createImap,log=console.log}={}){
 if(started||now()>=EXPIRES_AT||env.NODE_ENV==='test'||env.RENDER_SERVICE_ID!=='srv-d79k9os50q8c73fkeqig')return null;
 started=true;
 const result={diagnostic:'EMRADAR_MAILBOX_AUTH_V1',smtp:'FAIL',imap:'FAIL',emails_sent:0,external_actions:0};
 const user=env.EDITORIAL_SMTP_USER;
 if(user!=='sean@emradar.net'||!env.EDITORIAL_SMTP_PASSWORD||!env.EDITORIAL_SMTP_HOST||!env.EDITORIAL_IMAP_HOST){
  result.reason='CANONICAL_MAILBOX_CONFIGURATION_REQUIRED';log('EMRADAR_MAILBOX_AUTH '+JSON.stringify(result));return result;
 }
 const auth={user,pass:env.EDITORIAL_SMTP_PASSWORD};
 let smtp,imap;
 try{
  smtp=(createTransport||require('nodemailer').createTransport)({
   host:env.EDITORIAL_SMTP_HOST,port:Number(env.EDITORIAL_SMTP_PORT||465),
   secure:(env.EDITORIAL_SMTP_SECURE||'true')==='true',auth,
   logger:false,debug:false,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000
  });
  await smtp.verify();result.smtp='PASS';
 }catch(e){result.smtp_reason=failure(e);}
 finally{try{smtp?.close();}catch{}}
 if(result.smtp==='PASS'){
  try{
   const options={host:env.EDITORIAL_IMAP_HOST,port:993,secure:true,auth,logger:false,logRaw:false,disableAutoIdle:true,
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000};
   imap=createImap?createImap(options):new (require('imapflow').ImapFlow)(options);
   // Never surface server responses or the client's error event.
   imap.on('error',()=>{});
   await imap.connect();result.imap='PASS';
  }catch(e){result.imap_reason=failure(e);}
  finally{if(imap){try{await imap.logout();}catch{try{imap.close();}catch{}}}}
 }else{result.imap_reason='NOT_ATTEMPTED_SMTP_FAILED';}
 log('EMRADAR_MAILBOX_AUTH '+JSON.stringify(result));return result;
}
module.exports={runAuthenticationProbe,EXPIRES_AT};

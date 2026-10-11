"use strict";
const crypto=require('node:crypto');
const nodemailer=require('nodemailer');
const brand=require('./email-brand.cjs');
const smtpConfig=()=>({host:process.env.EDITORIAL_SMTP_HOST,port:Number(process.env.EDITORIAL_SMTP_PORT||465),secure:(process.env.EDITORIAL_SMTP_SECURE||'true')==='true',auth:{user:process.env.EDITORIAL_SMTP_USER,pass:process.env.EDITORIAL_SMTP_PASSWORD}});
const canonicalConfigured=()=>!!(smtpConfig().host&&smtpConfig().auth.user===brand.identity.address&&smtpConfig().auth.pass&&smtpConfig().secure&&smtpConfig().port===465);
const brandStatus=()=>({status:canonicalConfigured()?'CONFIGURED':'BLOCKED',reason:canonicalConfigured()?null:'CANONICAL_SMTP_CONFIGURATION_REQUIRED',identity:brand.identity,brand_version:brand.version,configuration:{host_present:!!smtpConfig().host,user_matches:smtpConfig().auth.user===brand.identity.address,password_present:!!smtpConfig().auth.pass,tls: smtpConfig().secure&&smtpConfig().port===465}});
const {createOutcomeCollector}=require('./emradar-outcome-collector');
const expected='oroknows@gmail.com';
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function validBinding(mail,idempotency_key,binding,signature,secret){
 if(!binding||!secret||!/^[a-f0-9]{64}$/.test(signature||''))return false;
 const signed=crypto.createHmac('sha256',secret).update('EMRADAR_OWNER_APPROVED_DELIVERY_V1\n'+JSON.stringify({mail,idempotency_key,binding})).digest('hex');
 if(!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(signed)))return false;
 const {proposal:p,approval:a}=binding;
 let hash,key;
 if(binding.version==='EMRADAR_OWNER_APPROVED_DELIVERY_V2'){
  if(!p?.binding||a?.authority!=='OWNER'||a.decision!=='APPROVE'||a.proposal_id!==p.proposal_id||a.review_hash!==p.review_hash||p.delivery_key!==idempotency_key||digest(p.asset)!==digest(p.binding.asset)||p.campaign_id!==p.binding.campaign_id||['REJECTED','SUPERSEDED'].includes(p.status))return false;
  hash=digest(p.binding);key=p.delivery_key;
 }else{
  if(!p?.review_binding||p.product!=='EMRADAR'||a?.approved_by!=='OWNER'||a.status!=='OWNER_APPROVED'||a.proposal_id!==p.proposal_id||a.review_hash!==p.review_hash||a.asset_hash!==digest(p.asset)||p.publication_key!==idempotency_key)return false;
  hash=digest({product_truth:p.review_binding.product_truth,signal_revision:p.signal_revision,asset:p.asset,destination:p.review_binding.destination,source_receipt:p.source_receipt||null});key=p.publication_key;
 }
 const e=p.asset?.email;
 let reviewed;try{reviewed=e?.brand_version?brand.envelope(e):{from:e.from,to:e.to,subject:e.subject,text:e.body};}catch{return false;}
 return hash===p.review_hash&&digest([key,hash])===p.proposal_id&&e?.to===p.asset.delivery?.public_contact_point&&JSON.stringify(mail)===JSON.stringify(reviewed)&&p.asset.copy===`Subject: ${e.subject}\n\n${e.body}`;
}
// Administrative owner review mail has a fixed recipient, sender and body template.
async function ownerNotification(req,res,createTransport,requests){
 const {notification:n,idempotency_key}=req.body||{};
 if(!n||!/^EMRADAR_\d{4}_\d{2}_\d{2}_LAUNCH$/.test(n.campaign_id||'')||!Number.isInteger(n.proposal_count)||n.proposal_count<1||n.proposal_count>10000||!Number.isInteger(n.email_group_count)||n.email_group_count<0||n.email_group_count>n.proposal_count||!/^https:\/\/emradar-x-executor\.onrender\.com\/OWNER_REVIEW#access=[a-f0-9]{64}$/.test(n.private_review_url||'')||idempotency_key!==crypto.createHash('sha256').update('owner-review-notification:'+n.campaign_id).digest('hex'))return res.status(409).json({reason:'OWNER_NOTIFICATION_CONTRACT_REQUIRED',definitely_unsent:true});
 if(!canonicalConfigured())return res.status(409).json({reason:'CANONICAL_SMTP_CONFIGURATION_REQUIRED',definitely_unsent:true});
 const date=n.campaign_id.slice(8,18).replaceAll('_','-');
 const mail={from:{name:brand.identity.name,address:brand.identity.address},to:expected,replyTo:brand.identity.reply_to,subject:'EMRADAR private campaign review — '+date,text:'Campaign '+date+' ('+n.campaign_id+') is ready for owner review.\n'+n.proposal_count+' saved proposals; '+n.email_group_count+' distinct email groups.\n\nOpen your private, single-use review link and approve or reject the saved groups or individual assets:\n'+n.private_review_url+'\n\nThe link expires after seven days. No publication is authorised until you approve its exact saved asset.',messageId:'<owner-review-'+idempotency_key+'@emradar.net>',headers:{'X-EMRADAR-Idempotency-Key':idempotency_key}};
 const requestKey='owner:'+idempotency_key,hash=digest(mail),prior=requests.get(requestKey);
 if(prior&&prior.hash!==hash)return res.status(409).json({reason:'IDEMPOTENCY_ARTIFACT_CHANGED',definitely_unsent:true});
 let promise=prior?.promise;
 if(!promise){
  promise=Promise.resolve().then(async()=>{
   const transport=createTransport({...smtpConfig(),connectionTimeout:10000,greetingTimeout:10000,socketTimeout:30000});
   try{
    const info=await transport.sendMail(mail);
    if(!info.messageId||!info.accepted?.includes(expected)){const e=Error('OWNER_NOTIFICATION_NOT_ACCEPTED');e.definitely_unsent=!info.accepted?.length;throw e;}
    return {message_id:info.messageId,accepted:[expected],rejected:info.rejected||[],response:typeof info.response==='string'?info.response.replace(/[a-f0-9]{64}/g,'[redacted]'):null};
   }catch(e){
    if(['ECONNECTION','EDNS','EAUTH'].includes(e.code)||e.command==='CONN'||Number(e.responseCode)>=400&&Number(e.responseCode)<600)e.definitely_unsent=true;
    throw e;
   }finally{transport.close();}
  });requests.set(requestKey,{hash,promise});
 }
 try{return res.json(await promise);}catch(e){
  if(e.definitely_unsent===true)requests.delete(requestKey);
  return res.status(409).json({reason:'OWNER_NOTIFICATION_SUBMISSION_FAILED',definitely_unsent:e.definitely_unsent===true});
 }
}
// Identical concurrent requests share one send and retain its provider result.
function createEmailRelay({createTransport=nodemailer.createTransport,collectOutcome=createOutcomeCollector()}={}){
 console.log('EDITORIAL_CORRESPONDENT_RUNTIME '+JSON.stringify({version:'human-correspondence-v2',identity:'Sean Walker',public_sender:brand.identity.address,reply_to:brand.identity.reply_to,brand_version:brand.version,configured_sender:canonicalConfigured()?brand.identity.address:null,hidden_rewrite:false}));
 const requests=new Map();
 return async(req,res)=>{
  const expectedAuth='Bearer '+process.env.EMRADAR_EMAIL_RELAY_TOKEN,actual=req.headers.authorization||'';
  if(!process.env.EMRADAR_EMAIL_RELAY_TOKEN||actual.length!==expectedAuth.length||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expectedAuth)))return res.status(403).json({reason:'EMAIL_RELAY_AUTH_REQUIRED'});
  if(req.params.operation==='owner-notification')return ownerNotification(req,res,createTransport,requests);
  const {user,password,mail,idempotency_key,binding,signature}=req.body||{};
  if(req.params.operation==='status')return res.json(brandStatus());
  if(req.params.operation==='collect'){
   if(req.body.receipt?.sender_identity?.address!==brand.identity.address&&(user!==expected||!password))return res.status(409).json({reason:'EDITORIAL_AUTHENTICATED_SENDER_MISMATCH'});
   try{const canonical=req.body.receipt?.sender_identity?.address===brand.identity.address;
    if(canonical&&(!process.env.EDITORIAL_IMAP_HOST||!canonicalConfigured()))return res.status(409).json({reason:'CANONICAL_IMAP_CONFIGURATION_REQUIRED'});
    return res.json(await collectOutcome({user:canonical?brand.identity.address:user,password:canonical?smtpConfig().auth.pass:password,host:canonical?process.env.EDITORIAL_IMAP_HOST:undefined,receipt:req.body.receipt}));}
   catch(e){return res.status(409).json({reason:e.authenticationFailed?'GMAIL_READ_AUTHORIZATION_REQUIRED':'GMAIL_READ_COLLECTION_FAILED',code:e.code||null});}
  }
  if(!canonicalConfigured())return res.status(409).json(brandStatus());
  const transport=createTransport({...smtpConfig(),connectionTimeout:10000,greetingTimeout:10000,socketTimeout:30000});
  try{
   if(req.params.operation==='verify'){await transport.verify();return res.json({status:'PASS',authenticated_user:brand.identity.address,reply_to:brand.identity.reply_to,transport:'EXISTING_STARTER_CANONICAL_SMTP_RELAY'});}
   if(req.params.operation!=='submit')return res.status(404).json({reason:'UNKNOWN_RELAY_OPERATION'});
   if(!mail||mail.from?.address!==brand.identity.address||mail.from?.name!=='Sean Walker'||!validBinding(mail,idempotency_key,binding,signature,process.env.EMRADAR_EMAIL_RELAY_TOKEN)||!mail.subject||/[\r\n]/.test(mail.subject)||!mail.text||!/^[a-f0-9]{64}$/.test(idempotency_key||''))return res.status(409).json({reason:'REVIEWED_EMAIL_ENVELOPE_REQUIRED'});
   const hash=crypto.createHash('sha256').update(JSON.stringify(mail)).digest('hex'),prior=requests.get(idempotency_key);
   if(prior){if(prior.hash!==hash)return res.status(409).json({reason:'IDEMPOTENCY_ARTIFACT_CHANGED'});return res.json(await prior.promise);}
   const promise=Promise.resolve().then(async()=>{
    const info=await transport.sendMail({...mail,headers:{'X-EMRADAR-Idempotency-Key':idempotency_key}});
    return {messageId:info.messageId,accepted:info.accepted,rejected:info.rejected||[]};
   });
   requests.set(idempotency_key,{hash,promise});
   try{return res.json(await promise);}catch(e){requests.delete(idempotency_key);throw e;}
  }catch(e){return res.status(409).json({reason:e.message,code:e.code||null,command:e.command||null});}
  finally{transport.close();}
 };
}
module.exports={createEmailRelay,validBinding,brandStatus};



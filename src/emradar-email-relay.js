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
 if(!p?.review_binding||p.product!=='EMRADAR'||a?.approved_by!=='OWNER'||a.status!=='OWNER_APPROVED'||a.proposal_id!==p.proposal_id||a.review_hash!==p.review_hash||a.asset_hash!==digest(p.asset)||p.publication_key!==idempotency_key)return false;
 const hash=digest({product_truth:p.review_binding.product_truth,signal_revision:p.signal_revision,asset:p.asset,destination:p.review_binding.destination,source_receipt:p.source_receipt||null});
 const e=p.asset?.email;
 let reviewed;try{reviewed=e?.brand_version?brand.envelope(e):{from:e.from,to:e.to,subject:e.subject,text:e.body};}catch{return false;}
 return hash===p.review_hash&&digest([p.publication_key,hash])===p.proposal_id&&e?.to===p.asset.delivery?.public_contact_point&&JSON.stringify(mail)===JSON.stringify(reviewed)&&p.asset.copy===`Subject: ${e.subject}\n\n${e.body}`;
}
// Durable approval, IN_FLIGHT and ambiguity locks remain in EMRADAR Redis.
// This transport never retries; an uncertain response must be reconciled there.
function createEmailRelay({createTransport=nodemailer.createTransport,collectOutcome=createOutcomeCollector()}={}){
 console.log('EDITORIAL_CORRESPONDENT_RUNTIME '+JSON.stringify({version:'human-correspondence-v2',identity:'Sean Walker',public_sender:brand.identity.address,reply_to:brand.identity.reply_to,brand_version:brand.version,configured_sender:canonicalConfigured()?brand.identity.address:null,hidden_rewrite:false}));
 const requests=new Map();
 return async(req,res)=>{
  const expectedAuth='Bearer '+process.env.EMRADAR_EMAIL_RELAY_TOKEN,actual=req.headers.authorization||'';
  if(!process.env.EMRADAR_EMAIL_RELAY_TOKEN||actual.length!==expectedAuth.length||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expectedAuth)))return res.status(403).json({reason:'EMAIL_RELAY_AUTH_REQUIRED'});
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
   if(prior){if(prior.hash!==hash)return res.status(409).json({reason:'IDEMPOTENCY_ARTIFACT_CHANGED'});if(prior.result)return res.json(prior.result);return res.status(409).json({reason:'AMBIGUOUS_PUBLICATION_RECOVERY_REQUIRED'});}
   requests.set(idempotency_key,{hash});
   const info=await transport.sendMail({...mail,headers:{'X-EMRADAR-Idempotency-Key':idempotency_key}});
   const result={messageId:info.messageId,accepted:info.accepted,rejected:info.rejected||[]};requests.set(idempotency_key,{hash,result});return res.json(result);
  }catch(e){return res.status(409).json({reason:e.message,code:e.code||null,command:e.command||null});}
  finally{transport.close();}
 };
}
module.exports={createEmailRelay,validBinding,brandStatus};


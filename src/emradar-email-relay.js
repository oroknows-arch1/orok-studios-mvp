"use strict";
const crypto=require('node:crypto');
const nodemailer=require('nodemailer');
const {createOutcomeCollector}=require('./emradar-outcome-collector');
const expected='oroknows@gmail.com';
const recipients=new Set(['breakingviews.guest@thomsonreuters.com','paul@im-mining.com','chloe@australianminingreview.com.au','editorial@redimin.cl']);
// Durable approval, IN_FLIGHT and ambiguity locks remain in EMRADAR Redis.
// This transport never retries; an uncertain response must be reconciled there.
function createEmailRelay({createTransport=nodemailer.createTransport,collectOutcome=createOutcomeCollector()}={}){
 console.log('EDITORIAL_CORRESPONDENT_RUNTIME '+JSON.stringify({version:'human-correspondence-v2',identity:'Sean Walker',authenticated_sender:expected,hidden_rewrite:false}));
 const requests=new Map();
 return async(req,res)=>{
  const expectedAuth='Bearer '+process.env.EMRADAR_EMAIL_RELAY_TOKEN,actual=req.headers.authorization||'';
  if(!process.env.EMRADAR_EMAIL_RELAY_TOKEN||actual.length!==expectedAuth.length||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expectedAuth)))return res.status(403).json({reason:'EMAIL_RELAY_AUTH_REQUIRED'});
  const {user,password,mail,idempotency_key}=req.body||{};
  if(user!==expected||!password)return res.status(409).json({reason:'EDITORIAL_AUTHENTICATED_SENDER_MISMATCH'});
  if(req.params.operation==='collect'){
   try{return res.json(await collectOutcome({user,password,receipt:req.body.receipt}));}
   catch(e){return res.status(409).json({reason:e.authenticationFailed?'GMAIL_READ_AUTHORIZATION_REQUIRED':'GMAIL_READ_COLLECTION_FAILED',code:e.code||null});}
  }
  const transport=createTransport({service:'gmail',auth:{user,pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:30000});
  try{
   if(req.params.operation==='verify'){await transport.verify();return res.json({status:'PASS',authenticated_user:user,transport:'EXISTING_STARTER_GMAIL_RELAY'});}
   if(req.params.operation!=='submit')return res.status(404).json({reason:'UNKNOWN_RELAY_OPERATION'});
   if(!mail||mail.from?.address!==expected||mail.from?.name!=='Sean Walker'||!recipients.has(mail.to)||!mail.subject||/[\r\n]/.test(mail.subject)||!mail.text||!/^[a-f0-9]{64}$/.test(idempotency_key||''))return res.status(409).json({reason:'REVIEWED_EMAIL_ENVELOPE_REQUIRED'});
   const hash=crypto.createHash('sha256').update(JSON.stringify(mail)).digest('hex'),prior=requests.get(idempotency_key);
   if(prior){if(prior.hash!==hash)return res.status(409).json({reason:'IDEMPOTENCY_ARTIFACT_CHANGED'});if(prior.result)return res.json(prior.result);return res.status(409).json({reason:'AMBIGUOUS_PUBLICATION_RECOVERY_REQUIRED'});}
   requests.set(idempotency_key,{hash});
   const info=await transport.sendMail({...mail,headers:{'X-EMRADAR-Idempotency-Key':idempotency_key}});
   const result={messageId:info.messageId,accepted:info.accepted,rejected:info.rejected||[]};requests.set(idempotency_key,{hash,result});return res.json(result);
  }catch(e){return res.status(409).json({reason:e.message,code:e.code||null,command:e.command||null});}
  finally{transport.close();}
 };
}
module.exports={createEmailRelay};

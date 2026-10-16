'use strict';
const nodemailer=require('nodemailer');
const brand=require('./email-brand.cjs');
const MailComposer=require('nodemailer/lib/mail-composer');
const {ImapFlow}=require('imapflow');
const {assertRecipientAllowed}=require('./emradar-v3-recipient.cjs');

// V3-only SMTP adapter. Does not authorize a send: the V3 boundary must
// verify durable owner approval and reserve the exact delivery first.
function createV3Smtp({env=process.env,createTransport=nodemailer.createTransport,createImap=options=>new ImapFlow(options)}={}){
 const config=()=>{
  if(!env.EDITORIAL_SMTP_HOST||env.EDITORIAL_SMTP_USER!==brand.identity.address||!env.EDITORIAL_SMTP_PASSWORD||
     Number(env.EDITORIAL_SMTP_PORT||465)!==465||(env.EDITORIAL_SMTP_SECURE||'true')!=='true')throw Error('V3_CANONICAL_SMTP_REQUIRED');
  return {host:env.EDITORIAL_SMTP_HOST,port:465,secure:true,auth:{user:env.EDITORIAL_SMTP_USER,pass:env.EDITORIAL_SMTP_PASSWORD},
   connectionTimeout:10000,greetingTimeout:10000,socketTimeout:30000};
 };
 const send=async (mail,recipient=mail.to)=>{
  const transport=createTransport(config());
  try{
   const info=await transport.sendMail(mail);
   if(!info?.messageId||!Array.isArray(info.accepted)||!info.accepted.includes(recipient))throw Error('V3_SMTP_OUTCOME_UNCONFIRMED');
   return info;
  }finally{transport.close();}
 };
 const openMailbox=async()=>{
  config();
  if(!env.EDITORIAL_IMAP_HOST)throw Error('V3_IMAP_NOT_CONFIGURED');
  const client=createImap({host:env.EDITORIAL_IMAP_HOST,port:993,secure:true,auth:{user:env.EDITORIAL_SMTP_USER,pass:env.EDITORIAL_SMTP_PASSWORD},logger:false,disableAutoIdle:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
  client.on('error',()=>{});
  try{await client.connect();return client;}catch(error){try{client.close();}catch{}throw error;}
 };
 const sentFolder=async client=>{
  const boxes=await client.list();
  return boxes.find(box=>box.specialUse==='\\Sent'&&!box.flags?.has('\\Noselect'))?.path??boxes.find(box=>/(^|[/.])sent(?: items| messages)?$/i.test(box.path)&&!box.flags?.has('\\Noselect'))?.path??null;
 };
 const closeMailbox=async client=>{if(client)try{await client.logout();}catch{try{client.close();}catch{}}};
 const archiveSent=async raw=>{
  let client;
  try{
   client=await openMailbox();const path=await sentFolder(client);
   if(!path)return {status:'UNAVAILABLE',reason:'SENT_FOLDER_NOT_FOUND'};
   const result=await client.append(path,raw,['\\Seen']);
   if(!result||result===true)return {status:'UNCONFIRMED',folder:path};
   return {status:'APPENDED',folder:path,uid:result.uid??null,uid_validity:result.uidValidity?.toString()??null};
  }catch{return {status:'FAILED',reason:'IMAP_ARCHIVE_FAILED'};}
  finally{await closeMailbox(client);}
 };
 return {
  verifyTransport:async()=>{
   const result={provider:/purelymail\.com$/i.test(env.EDITORIAL_SMTP_HOST||'')?'Purelymail':'EXISTING_SMTP',smtp:'FAIL',imap:'FAIL',sent_folder:{status:'UNKNOWN'},emails_sent:0};
   let transport,client;
   try{transport=createTransport(config());await transport.verify();result.smtp='PASS';}catch{result.smtp_reason='SMTP_AUTH_OR_CONNECTION_FAILED';}finally{transport?.close();}
   try{client=await openMailbox();result.imap='PASS';const path=await sentFolder(client);result.sent_folder=path?{status:'AVAILABLE',folder:path}:{status:'UNAVAILABLE',reason:'SENT_FOLDER_NOT_FOUND'};}
   catch{result.imap_reason='IMAP_AUTH_OR_CONNECTION_FAILED';}
   finally{await closeMailbox(client);}
   return result;
  },
  sendOwnerReview:async payload=>{
   if(payload?.to!=='oroknows@gmail.com'||typeof payload.private_review_url!=='string')throw Error('V3_OWNER_MAIL_INVALID');
   const info=await send({from:{name:brand.identity.name,address:brand.identity.address},to:payload.to,
    replyTo:brand.identity.reply_to,subject:'EMRADAR private campaign review',
    text:'Your private EMRADAR campaign review link:\n'+payload.private_review_url});
   return {accepted:true,provider_id:info.messageId};
  },
  sendApprovedEmail:async payload=>{
   const asset=payload?.asset;
   if(asset?.kind!=='EMAIL'||!asset.to||!asset.subject||!asset.body||(asset.from!==brand.identity.address&&asset.from?.address!==brand.identity.address))throw Error('V3_EMAIL_ASSET_INVALID');
   assertRecipientAllowed(asset);
   if(!/^[a-f0-9]{64}$/.test(payload.idempotency_key||''))throw Error('V3_DELIVERY_CLAIM_INVALID');
   const envelope=asset.brand_version?brand.envelope(asset):{from:{name:brand.identity.name,address:brand.identity.address},to:asset.to,replyTo:brand.identity.reply_to,subject:asset.subject,text:asset.body};
   const raw=await new MailComposer({...envelope,messageId:'<emradar-'+payload.idempotency_key+'@emradar.net>',headers:{'X-EMRADAR-Idempotency-Key':payload.idempotency_key}}).compile().build();
   const info=await send({envelope:{from:brand.identity.address,to:asset.to},raw},asset.to);
   // SMTP acceptance remains final even if mailbox filing fails. Never resend
   // an accepted message to repair a Sent-folder problem.
   const sent_folder=await archiveSent(raw);
   return {accepted:true,receipt_id:info.messageId,smtp_response:info.response??null,sent_folder};
  }
 };
}
module.exports={createV3Smtp};

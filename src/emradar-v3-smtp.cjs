'use strict';
const nodemailer=require('nodemailer');
const brand=require('./email-brand.cjs');

// V3-only SMTP adapter. Does not authorize a send: the V3 boundary must
// verify durable owner approval and reserve the exact delivery first.
function createV3Smtp({env=process.env,createTransport=nodemailer.createTransport}={}){
 const config=()=>{
  if(!env.EDITORIAL_SMTP_HOST||env.EDITORIAL_SMTP_USER!==brand.identity.address||!env.EDITORIAL_SMTP_PASSWORD||
     Number(env.EDITORIAL_SMTP_PORT||465)!==465||(env.EDITORIAL_SMTP_SECURE||'true')!=='true')throw Error('V3_CANONICAL_SMTP_REQUIRED');
  return {host:env.EDITORIAL_SMTP_HOST,port:465,secure:true,auth:{user:env.EDITORIAL_SMTP_USER,pass:env.EDITORIAL_SMTP_PASSWORD},
   connectionTimeout:10000,greetingTimeout:10000,socketTimeout:30000};
 };
 const send=async mail=>{
  const transport=createTransport(config());
  try{
   const info=await transport.sendMail(mail);
   if(!info?.messageId||!Array.isArray(info.accepted)||!info.accepted.includes(mail.to))throw Error('V3_SMTP_OUTCOME_UNCONFIRMED');
   return info.messageId;
  }finally{transport.close();}
 };
 return {
  sendOwnerReview:async payload=>{
   if(payload?.to!=='oroknows@gmail.com'||typeof payload.private_review_url!=='string')throw Error('V3_OWNER_MAIL_INVALID');
   const provider_id=await send({from:{name:brand.identity.name,address:brand.identity.address},to:payload.to,
    replyTo:brand.identity.reply_to,subject:'EMRADAR private campaign review',
    text:'Your private EMRADAR campaign review link:\n'+payload.private_review_url});
   return {accepted:true,provider_id};
  },
  sendApprovedEmail:async payload=>{
   const asset=payload?.asset;
   if(asset?.kind!=='EMAIL'||!asset.to||!asset.subject||!asset.body||(asset.from!==brand.identity.address&&asset.from?.address!==brand.identity.address))throw Error('V3_EMAIL_ASSET_INVALID');
   const envelope=asset.brand_version?brand.envelope(asset):{from:{name:brand.identity.name,address:brand.identity.address},to:asset.to,replyTo:brand.identity.reply_to,subject:asset.subject,text:asset.body};
   const receipt_id=await send({...envelope,headers:{'X-EMRADAR-Idempotency-Key':payload.idempotency_key}});
   return {accepted:true,receipt_id};
  }
 };
}
module.exports={createV3Smtp};

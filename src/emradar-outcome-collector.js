'use strict';
const {ImapFlow}=require('imapflow');
const {simpleParser}=require('mailparser');
const crypto=require('node:crypto');
const expected='oroknows@gmail.com';
const messageIds=value=>String(value||'').match(/<[^<>\s]+@[^<>\s]+>/g)||[];
const addresses=value=>(value?.value||[]).map(v=>String(v.address||'').toLowerCase());
function matchOutcome(parsed,receipt,reference){
 const original=receipt.message_id,refs=[...messageIds(parsed.inReplyTo),...messageIds(parsed.references)];
 const date=parsed.date?.toISOString();
 if(!date||Date.parse(date)<Date.parse(receipt.submitted_at))return null;
 const headers=parsed.headers||new Map();
 const report=(parsed.attachments||[]).find(a=>a.contentType==='message/delivery-status');
 const originalPart=(parsed.attachments||[]).find(a=>['message/rfc822','text/rfc822-headers'].includes(a.contentType));
 const reportText=report?.content.toString()||'',originalText=originalPart?.content.toString()||'';
 const originalIds=[...messageIds(headers.get('original-message-id')),...messageIds(reportText.match(/^Original-Message-ID:\s*(.*)$/mi)?.[1]),...messageIds(originalText.match(/^Message-ID:\s*(.*)$/mi)?.[1])];
 if(report&&originalIds.includes(original)){
   // Match the recipient block, never a different recipient in a multi-recipient DSN.
   const block=reportText.split(/\r?\n\r?\n/).find(b=>b.match(/^Final-Recipient:\s*[^;]+;\s*(\S+)/mi)?.[1]?.toLowerCase()===receipt.recipient.toLowerCase());
   const action=block?.match(/^Action:\s*(\S+)/mi)?.[1]?.toLowerCase(),status=block?.match(/^Status:\s*(\S+)/mi)?.[1];
   if(action==='failed'&&/^5\./.test(status||''))return {state:'BOUNCED',at:date,evidence:{type:'MATCHED_DELIVERY_STATUS_NOTIFICATION',reference,reply_message_id:parsed.messageId,matched_original_message_id:original,recipient:receipt.recipient,action,dsn_status:status}};
 }
 if(refs.includes(original)&&addresses(parsed.from).includes(receipt.recipient.toLowerCase())&&addresses(parsed.to).includes(expected))return {state:'RESPONSE_RECEIVED',at:date,evidence:{type:'MATCHED_GMAIL_REPLY_HEADERS',reference,reply_message_id:parsed.messageId,matched_original_message_id:original,recipient:receipt.recipient,classification:'RESPONSE_ONLY_NO_SENTIMENT_INFERENCE'}};
 return null;
}
function createOutcomeCollector({createClient=options=>new ImapFlow(options),parse=simpleParser}={}){
 return async({user,password,receipt})=>{
  if(user!==expected||!password||!receipt?.id||!/^<[^<>\s]+@[^<>\s]+>$/.test(receipt.message_id||'')||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receipt.recipient||'')||!Number.isFinite(Date.parse(receipt.submitted_at)))throw new Error('MATCHED_DISTRIBUTION_RECEIPT_REQUIRED');
  const client=createClient({host:'imap.gmail.com',port:993,secure:true,auth:{user,pass:password},logger:false,logRaw:false,disableAutoIdle:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
  const publication_candidates=[],events=[],checks=[],checked_at=new Date().toISOString();let complete=true;
  const timer=setTimeout(()=>client.close(),35000);timer.unref?.();
  try{
   await client.connect();const boxes=await client.list();
   const all=boxes.find(b=>b.specialUse==='\\All'),junk=boxes.find(b=>b.specialUse==='\\Junk'),trash=boxes.find(b=>b.specialUse==='\\Trash');
   const folders=[all?.path||'INBOX',junk?.path,trash?.path].filter(Boolean);
   for(const path of folders){
    const lock=await client.getMailboxLock(path,{readOnly:true});
    try{
     const since=new Date(receipt.submitted_at);since.setUTCDate(since.getUTCDate()-1);
     const uids=await client.search({since,or:[{header:{'In-Reply-To':receipt.message_id}},{header:{References:receipt.message_id}},{header:{'Original-Message-ID':receipt.message_id}},{body:receipt.message_id}]},{uid:true});
     if(uids.length>20)complete=false;
     const check={mailbox:path,uid_validity:String(client.mailbox.uidValidity),matches:uids.length,fetched:Math.min(20,uids.length),read_only:true};checks.push(check);
     for(const uid of uids.slice(-20)){
      const message=await client.fetchOne(uid,{source:{start:0,maxLength:65536},size:true,uid:true,threadId:true},{uid:true});
      if(!message?.source||message.size>65536){complete=false;continue;}
      const parsed=await parse(message.source,{skipHtmlToText:true,skipTextToHtml:true});
      const reference='gmail-imap:'+expected+':'+encodeURIComponent(path)+':'+check.uid_validity+':'+uid;
      const event=matchOutcome(parsed,receipt,reference);if(event){if(event.state==='RESPONSE_RECEIVED'&&receipt.publication_domain){for(const link of (parsed.text||'').slice(0,20000).match(/https:\/\/[^\s<>"']+/g)||[]){try{const url=new URL(link);if(url.hostname.replace(/^www\./,'')===receipt.publication_domain&&!url.port&&!url.username&&!url.password&&publication_candidates.length<3&&!publication_candidates.includes(url.href))publication_candidates.push(url.href);}catch{}}}event.evidence.thread_id=message.threadId||null;event.evidence.message_sha256=crypto.createHash('sha256').update(message.source).digest('hex');if(!events.some(e=>e.evidence.reply_message_id===event.evidence.reply_message_id))events.push(event);}
     }
    }finally{lock.release();}
   }
   return {source:'GMAIL_IMAP_MATCHED_RECEIPT',metrics:{},events,publication_candidates,collection:{status:'CHECKED',complete,authenticated_user:user,reference:'gmail-imap-check:'+receipt.id+':'+checked_at,checks,last_checked_at:checked_at}};
  }finally{clearTimeout(timer);await client.logout().catch(()=>client.close());}
 };
}
module.exports={createOutcomeCollector,matchOutcome};

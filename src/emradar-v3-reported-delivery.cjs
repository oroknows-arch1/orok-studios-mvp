'use strict';
const campaignId='v3-ae9ca0227fe23e1c807a80734dc1ae55';
const reported=['web-3714389c5dbacb190bbe','web-089f1089aeeeb8d5f30e'];
async function reconcileReportedEmail({pool,store,state,id,inspect}){
 if(state.id!==campaignId || !reported.includes(id))return;
 const entry=state.assets[id];
 if(state.deliveries[id])throw Error('V3_SENT_RECONCILIATION_REQUIRED');
 const rows=(await pool.query('SELECT status,provider_id,asset_sha256,idempotency_key FROM v3_send_reservations WHERE campaign_id=$1 AND destination_id=$2',[campaignId,id])).rows;
 const saved=rows[0];
 const priorAddresses=[entry,...(state.editorial_versions?.[id]??[])].map(v=>v.asset?.to).filter(Boolean);
 if(!priorAddresses.length)throw Error('V3_SENT_RECONCILIATION_REQUIRED');
 let matches=0;
 if(!saved){
  try{for(const to of new Set(priorAddresses))matches+=(await inspect({to,since:'2026-11-24T00:00:00Z'})).matches;}
  catch{throw Error('V3_SENT_RECONCILIATION_REQUIRED');}
 }
 const accepted=saved?.status==='ACCEPTED' && Boolean(saved.provider_id);
 const check={fingerprint:entry.fingerprint,checked_at:new Date().toISOString(),status:saved?'RESERVATION_FOUND':matches?'POSSIBLE_SENT_COPY':'NO_MATCH',matches};
 await store.mutate(campaignId,current=>{
  if(current.assets[id].fingerprint!==entry.fingerprint)throw Error('STALE_ASSET_REVISION');
  current.reported_email_checks??={};current.reported_email_checks[id]=check;
  if(!current.deliveries[id]&&(saved||matches)){
   current.deliveries[id]={status:accepted?'CONFIRMED':'AMBIGUOUS',idempotency_key:saved?.idempotency_key??null,
    receipt:accepted?{provider_id:saved.provider_id,asset_sha256:saved.asset_sha256}:{reason:saved?'Prior transport reservation':'Possible earlier send found in Purelymail Sent'}};
  }
  return current;
 });
 if(saved||matches)throw Error('V3_SENT_RECONCILIATION_REQUIRED');
}
module.exports={campaignId,reported,reconcileReportedEmail};

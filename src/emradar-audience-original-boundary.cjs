'use strict';
const {createHash}=require('node:crypto');
const sha=text=>createHash('sha256').update(text.normalize('NFC').replace(/\s+/g,' ').trim()).digest('hex');
const sydneyDay=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
// Reuses the existing post/receipt table. A session advisory lock serialises all
// originals for the account, including different campaigns and worker processes.
async function initializeOriginals(pool){
 await pool.query(`ALTER TABLE emradar_x_thread_posts ADD COLUMN IF NOT EXISTS account_id TEXT,
 ADD COLUMN IF NOT EXISTS source_key TEXT, ADD COLUMN IF NOT EXISTS text_sha256 TEXT,
 ADD COLUMN IF NOT EXISTS quota_day TEXT`);
 await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS audience_original_discovery ON emradar_x_thread_posts(account_id,source_key,record_id) WHERE account_id IS NOT NULL`);
 await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS audience_original_text ON emradar_x_thread_posts(account_id,text_sha256) WHERE account_id IS NOT NULL`);
}
async function withOriginalBoundary({pool,account_id,campaign_id,sequence,segment,source_key,loadHistory,verifyApproval,submit,clock=()=>Date.now()}){
 if(!/^\d+$/.test(account_id??'')||!segment?.record_id||segment.parent_sequence!==null||typeof loadHistory!=='function'||typeof verifyApproval!=='function')throw Error('AUDIENCE_ORIGINAL_BOUNDARY_REQUIRED');
 const client=await pool.connect();let locked=false,claimed=false;
 const quota=async()=>{
  const legacy=await client.query("SELECT 1 FROM emradar_x_thread_posts WHERE account_id IS NULL AND status IN ('RESERVED','AMBIGUOUS') LIMIT 1");
  if(legacy.rows.length)throw Error('AUDIENCE_LEGACY_ATTEMPT_UNRESOLVED');
  const day=sydneyDay(clock()),history=await loadHistory({account_id,day});
  if(history?.complete!==true||history.account_id!==account_id||history.day!==day||!Array.isArray(history.posts)||history.posts.some(p=>!/^\d+$/.test(p.id??'')||sydneyDay(Date.parse(p.created_at))!==day))throw Error('AUDIENCE_HISTORY_INCOMPLETE');
  const known=new Set(history.posts.map(p=>p.id));
  const rows=(await client.query(`SELECT campaign_id,sequence,status,receipt_id,quota_day FROM emradar_x_thread_posts WHERE account_id=$1 AND (quota_day=$2 OR status IN ('RESERVED','AMBIGUOUS'))`,[account_id,day])).rows;
  // Count external/manual originals too. Count all unresolved attempts across
  // midnight, and accepted receipts missing from a delayed timeline response.
  const other=rows.filter(r=>!(r.campaign_id===campaign_id&&r.sequence===sequence&&r.status==='RESERVED'));
  const used=known.size+other.filter(r=>!r.receipt_id||!known.has(r.receipt_id)).length;
  if(used>=8)throw Error('AUDIENCE_DAILY_ORIGINAL_LIMIT');
  return day;
 };
 try{
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',['audience-original:'+account_id]);locked=true;
  if(!await verifyApproval())throw Error('AUDIENCE_APPROVAL_STALE');
  const day=await quota();
  const reservation=await client.query(`UPDATE emradar_x_thread_posts SET status='RESERVED',account_id=$3,source_key=$4,text_sha256=$5,quota_day=$6,parent_receipt_id=NULL,updated_at=now()
   WHERE campaign_id=$1 AND sequence=$2 AND status='PENDING' RETURNING *`,[campaign_id,sequence,account_id,source_key,sha(segment.text),day]);
  if(reservation.rowCount!==1)throw Error('AUDIENCE_ORIGINAL_ALREADY_ATTEMPTED');claimed=true;
  // Called immediately before POST /2/tweets, after any media upload. A rollover
  // rechecks today's actual history while the same account lock is held.
  const beforePost=async()=>{
   if(!await verifyApproval())throw Error('AUDIENCE_APPROVAL_STALE');
   const currentDay=await quota();
   await client.query('UPDATE emradar_x_thread_posts SET quota_day=$3 WHERE campaign_id=$1 AND sequence=$2',[campaign_id,sequence,currentDay]);
  };
  return await submit({beforePost});
 }catch(error){
  if(claimed)await client.query("UPDATE emradar_x_thread_posts SET status='AMBIGUOUS',updated_at=now() WHERE campaign_id=$1 AND sequence=$2 AND status='RESERVED'",[campaign_id,sequence]);
  throw error;
 }finally{
  if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['audience-original:'+account_id]);client.release();
 }
}
module.exports={initializeOriginals,withOriginalBoundary,sydneyDay};

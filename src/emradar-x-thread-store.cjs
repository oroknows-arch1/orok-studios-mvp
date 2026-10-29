'use strict';
// Independent storage. Never modifies existing V3 send reservations.
const {assetHash}=require('./emradar-audience-asset-hash.cjs');
class ThreadStore{
 constructor(pool){if(typeof pool?.query!=='function')throw Error('THREAD_POOL_REQUIRED');this.pool=pool;}
 async initialize(){
  await this.pool.query(`CREATE TABLE IF NOT EXISTS emradar_x_thread_posts (
   campaign_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0),
   record_id TEXT, approved_asset_sha256 TEXT NOT NULL,
   status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RESERVED','ACCEPTED','AMBIGUOUS')),
   receipt_id TEXT, parent_receipt_id TEXT,
   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
   PRIMARY KEY(campaign_id,sequence),UNIQUE(receipt_id),
   CHECK(status!='ACCEPTED' OR receipt_id IS NOT NULL),
   CHECK(status!='AMBIGUOUS' OR receipt_id IS NULL))`);
 }
 async register({campaign_id,approved_segments}={}){
  if(typeof campaign_id!=='string'||!campaign_id||!Array.isArray(approved_segments)||approved_segments.length<2)throw Error('THREAD_REGISTER_INVALID');
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   for(let i=0;i<approved_segments.length;i++){
    const s=approved_segments[i];
    if(s.sequence!==i+1||s.approval_status!=='APPROVED'||typeof s.text!=='string'||!s.text.trim())throw Error('THREAD_REGISTER_APPROVAL_REQUIRED');
    const h=assetHash(s);
    if(s.asset_sha256&&s.asset_sha256!==h)throw Error('THREAD_ASSET_HASH_MISMATCH');
    const q=await client.query(`INSERT INTO emradar_x_thread_posts(campaign_id,sequence,record_id,approved_asset_sha256)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[campaign_id,s.sequence,s.record_id||null,h]);
    if(q.rowCount!==1)throw Error('THREAD_ALREADY_REGISTERED');
   }
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async reserve({campaign_id,sequence}={}){
  if(!campaign_id||!Number.isInteger(sequence)||sequence<1)throw Error('THREAD_RESERVE_INVALID');
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   // Lock all campaign rows, preventing concurrent out-of-order reservations.
   const q=await client.query(`SELECT sequence,status,receipt_id FROM emradar_x_thread_posts
    WHERE campaign_id=$1 ORDER BY sequence FOR UPDATE`,[campaign_id]);
   const rows=q.rows,entry=rows.find(x=>x.sequence===sequence);
   if(!entry||entry.status!=='PENDING'||rows.some(x=>x.status==='RESERVED'||x.status==='AMBIGUOUS'))throw Error('THREAD_NOT_RESERVABLE');
   const preceding=rows.filter(x=>x.sequence<sequence);
   if(preceding.length!==sequence-1||preceding.some(x=>x.status!=='ACCEPTED'))throw Error('THREAD_PARENT_NOT_ACCEPTED');
   const parent=sequence===1?null:preceding[preceding.length-1].receipt_id;
   if(sequence>1&&!/^\d+$/.test(String(parent||'')))throw Error('THREAD_PARENT_RECEIPT_MISSING');
   await client.query(`UPDATE emradar_x_thread_posts SET status='RESERVED',parent_receipt_id=$3,updated_at=now()
     WHERE campaign_id=$1 AND sequence=$2`,[campaign_id,sequence,parent]);
   await client.query('COMMIT');return {campaign_id,sequence,parent_receipt_id:parent};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async record({campaign_id,sequence,receipt_id,ambiguous=false}={}){
  if(!campaign_id||!Number.isInteger(sequence)||sequence<1||(!ambiguous&&!/^\d+$/.test(String(receipt_id||''))))throw Error('THREAD_RECORD_INVALID');
  const q=await this.pool.query(`UPDATE emradar_x_thread_posts
    SET status=$3,receipt_id=$4,updated_at=now()
    WHERE campaign_id=$1 AND sequence=$2 AND status='RESERVED'
    RETURNING sequence,status,receipt_id,parent_receipt_id`,[campaign_id,sequence,ambiguous?'AMBIGUOUS':'ACCEPTED',ambiguous?null:String(receipt_id)]);
  if(q.rowCount!==1)throw Error('THREAD_RESERVATION_NOT_FOUND_OR_FINAL');
  return q.rows[0];
 }
}
module.exports={ThreadStore};

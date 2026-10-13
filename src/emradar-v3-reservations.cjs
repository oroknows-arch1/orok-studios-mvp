'use strict';
// Isolated V3 reservation storage. No DB connection is created at import time.
class V3Reservations {
 constructor(pool){if(typeof pool?.query!=='function')throw Error('V3_POSTGRES_POOL_REQUIRED');this.pool=pool;}
 async initialize(){
  await this.pool.query(`CREATE TABLE IF NOT EXISTS v3_send_reservations (
   idempotency_key TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,destination_id TEXT NOT NULL,
   asset_sha256 TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'RESERVED'
   CHECK(status IN ('RESERVED','ACCEPTED','AMBIGUOUS')),provider_id TEXT,
   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
   UNIQUE(campaign_id,destination_id))`);
  await this.pool.query(`CREATE TABLE IF NOT EXISTS v3_owner_notification_reservations (
   campaign_id TEXT PRIMARY KEY,link_sha256 TEXT NOT NULL,
   status TEXT NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED','ACCEPTED','AMBIGUOUS')),
   provider_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 }
 get send(){return {
  reserve:async ({idempotency_key,campaign_id,destination_id,asset_sha256})=>{
   if(!/^[a-f0-9]{64}$/.test(idempotency_key||'')||!/^[a-f0-9]{64}$/.test(asset_sha256||'')||!campaign_id||!destination_id)throw Error('V3_SEND_RESERVATION_INVALID');
   const r=await this.pool.query(`INSERT INTO v3_send_reservations(idempotency_key,campaign_id,destination_id,asset_sha256)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[idempotency_key,campaign_id,destination_id,asset_sha256]);
   if(r.rowCount!==1)throw Error('V3_SEND_ALREADY_RESERVED');
  },
  record:async ({idempotency_key,provider_id})=>{
   const r=await this.pool.query(`UPDATE v3_send_reservations SET status=$2,provider_id=$3,updated_at=now()
    WHERE idempotency_key=$1 AND status='RESERVED'`,[idempotency_key,provider_id?'ACCEPTED':'AMBIGUOUS',provider_id||null]);
   if(r.rowCount!==1)throw Error('V3_SEND_RESERVATION_NOT_FOUND_OR_FINAL');
  }
 };}
 get owner(){return {
  reserve:async ({campaign_id,link_sha256})=>{
   if(!campaign_id||!/^[a-f0-9]{64}$/.test(link_sha256||''))throw Error('V3_OWNER_RESERVATION_INVALID');
   const r=await this.pool.query(`INSERT INTO v3_owner_notification_reservations(campaign_id,link_sha256)
    VALUES($1,$2) ON CONFLICT DO NOTHING`,[campaign_id,link_sha256]);
   if(r.rowCount!==1)throw Error('V3_OWNER_NOTIFICATION_ALREADY_RESERVED');
  },
  record:async ({campaign_id,provider_id})=>{
   const r=await this.pool.query(`UPDATE v3_owner_notification_reservations SET status=$2,provider_id=$3,updated_at=now()
    WHERE campaign_id=$1 AND status='RESERVED'`,[campaign_id,provider_id?'ACCEPTED':'AMBIGUOUS',provider_id||null]);
   if(r.rowCount!==1)throw Error('V3_OWNER_RESERVATION_NOT_FOUND_OR_FINAL');
  }
 };}
}
module.exports={V3Reservations};

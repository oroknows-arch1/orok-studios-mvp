import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
export const OWNER_SESSION_TTL_MS=30*24*60*60*1000;
const hash=t=>createHash('sha256').update(t).digest('hex');
export function createOwnerSession(campaignId,{now=Date.now(),ttlMs=OWNER_SESSION_TTL_MS}={}) {
 if(!campaignId || ttlMs<60000 || ttlMs>OWNER_SESSION_TTL_MS) throw Error('INVALID_SESSION');
 const secret=randomBytes(32).toString('base64url');
 return {secret,record:{role:'OWNER',campaign_id:campaignId,secret_hash:hash(secret),expires_at:now+ttlMs,revoked_at:null}};
}
export function validateOwnerSession(record,secret,campaignId,{now=Date.now()}={}) {
 if(!record || record.role!=='OWNER' || record.campaign_id!==campaignId || record.revoked_at!==null || now>=record.expires_at || typeof secret!=='string') throw Error('OWNER_SESSION_REQUIRED');
 const a=Buffer.from(record.secret_hash,'hex'),b=Buffer.from(hash(secret),'hex');
 if(a.length!==b.length || !timingSafeEqual(a,b)) throw Error('OWNER_SESSION_REQUIRED');
 return true;
}
// Session records must be stored durably, hashed at rest, and checked for each write.

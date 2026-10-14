import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const digest = token => createHash('sha256').update(token).digest('hex');
export function issueReviewAccess({campaignId, now=Date.now(), ttlMs=24*60*60*1000}) {
 if (!campaignId || !Number.isSafeInteger(ttlMs) || ttlMs < 60000 || ttlMs > 7*86400000) throw Error('INVALID_REVIEW_REQUEST');
 const token=randomBytes(32).toString('base64url');
 return {token, record:{campaign_id:campaignId,token_hash:digest(token),expires_at:now+ttlMs,consumed_at:null}};
}
export function consumeReviewAccess(record,token,{now=Date.now()}={}) {
 if (!record || !token || typeof token!=='string' || record.consumed_at !== null || !Number.isFinite(record.expires_at) || now>=record.expires_at) throw Error('REVIEW_ACCESS_DENIED');
 const a=Buffer.from(record.token_hash,'hex'),b=Buffer.from(digest(token),'hex');
 if(a.length!==b.length || !timingSafeEqual(a,b)) throw Error('REVIEW_ACCESS_DENIED');
 return {...record,consumed_at:now};
}
// This function is a pure validator. Production MUST atomically compare-and-swap
// the token record before issuing an owner session. No in-memory consume is allowed.
export function assertOwnerSession(session,{campaignId,now=Date.now()}={}) {
 if (!session || session.campaign_id!==campaignId || session.role!=='OWNER' || session.revoked_at || !Number.isFinite(session.expires_at) || now>=session.expires_at) throw Error('OWNER_SESSION_REQUIRED');
 return true;
}

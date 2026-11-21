import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const digest = token => createHash('sha256').update(token).digest('hex');
const sameToken=(record,token)=>{
 if(!record || typeof record.token_hash!=='string'||!/^([a-f0-9]{64})$/.test(record.token_hash)||
    typeof token!=='string'||token.length<32||token.length>256)return false;
 const a=Buffer.from(record.token_hash,'hex'),b=Buffer.from(digest(token),'hex');
 return a.length===b.length&&timingSafeEqual(a,b);
};
// Owner invitation links are durable credentials, not one-day login codes.
// Only an explicit revoke/rotation can invalidate a link. Session cookies still
// have their own bounded lifetime, and every publication action is re-authorized.
export function issueReviewAccess({campaignId, now=Date.now()} = {}) {
 if (!campaignId || !Number.isFinite(now)) throw Error('INVALID_REVIEW_REQUEST');
 const token=randomBytes(32).toString('base64url');
 return {token, record:{campaign_id:campaignId,token_hash:digest(token),expires_at:null,permanent:true,revoked_at:null,consumed_at:null}};
}
export function consumeReviewAccess(record,token,{now=Date.now()}={}) {
 if (!record||record.revoked_at||!sameToken(record,token))throw Error('REVIEW_ACCESS_DENIED');
 // Legacy 24-hour and already-consumed invitations become reusable after this
 // upgrade, provided their exact SHA-256 token hash remains in durable history.
 return {...record,consumed_at:record.consumed_at??now};
}
export function matchesReviewAccess(review,token) {
 if(!review || !token)return false;
 if(!review.revoked_at&&sameToken(review,token))return true;
 return (review.previous_reviews??[]).some(record=>!record.revoked_at&&
   record.campaign_id===review.campaign_id&&sameToken(record,token));
}
// Legacy pure validator retained for existing callers.
export function assertOwnerSession(session,{campaignId,now=Date.now()}={}) {
 if (!session || session.campaign_id!==campaignId || session.role!=='OWNER' || session.revoked_at || !Number.isFinite(session.expires_at) || now>=session.expires_at) throw Error('OWNER_SESSION_REQUIRED');
 return true;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {issueReviewAccess,consumeReviewAccess,matchesReviewAccess} from '../vendor/emradar-v3/src/review-access.js';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';

test('new emailed invitation has no expiry and can be reopened after years',()=>{
 const {token,record}=issueReviewAccess({campaignId:'v3-test',now:1000});
 assert.equal(record.expires_at,null);
 assert.equal(record.permanent,true);
 assert.equal(matchesReviewAccess(record,token),true);
 assert.equal(consumeReviewAccess(record,token,{now:1000+15*365*86400000}).consumed_at,1000+15*365*86400000);
 assert.equal(matchesReviewAccess(record,'wrong'),false);
});
test('old expired and consumed links remain usable when token hash is present',()=>{
 const token='old-private-review-email-link-token-123';
 const legacy={campaign_id:'v3-old',token_hash:createHash('sha256').update(token).digest('hex'),expires_at:1,consumed_at:2};
 assert.equal(matchesReviewAccess(legacy,token),true);
 assert.equal(consumeReviewAccess(legacy,token,{now:10000000000}).consumed_at,2);
 assert.equal(matchesReviewAccess({...legacy,revoked_at:1},token),false);
});
function fixture(){
 const campaignId='v3-campaign',token='old-private-review-email-link-token-123';
 const review={campaign_id:campaignId,token_hash:createHash('sha256').update(token).digest('hex'),expires_at:1,consumed_at:2,status:'CONSUMED'};
 const data=new Map([['review:'+campaignId,review],[campaignId,{phase:'PUBLICATION_REVIEW'}]]);
 const adapter={read:async id=>data.has(id)?{value:data.get(id),version:1}:null,compareAndSwap:async(id,v,value)=>{data.set(id,value);return true}};
 const workflow=new ReviewWorkflow({adapter,store:{adapter},notify:async()=>{throw Error('NO_NEW_EMAIL')},baseUrl:'https://review.example.org',clock:()=>Date.UTC(2035,0,1)});
 return {workflow,data,token,campaignId};
}
test('same historical email link creates a fresh session repeatedly, without SMTP',async()=>{
 const {workflow,data,token,campaignId}=fixture();
 const first=await workflow.exchange(campaignId,token);
 const second=await workflow.exchange(campaignId,token);
 assert.notEqual(first.sessionId,second.sessionId);
 assert.equal(data.get('review:'+campaignId).status,'CONSUMED');
 assert.equal(await workflow.authenticate(campaignId,second.sessionId,second.secret),true);
 await assert.rejects(workflow.authenticate(campaignId,first.sessionId,first.secret),/OWNER_SESSION_REQUIRED/);
});
test('prior invitation remains usable following an explicitly revised link',async()=>{
 const {workflow,data,token,campaignId}=fixture();
 const current=issueReviewAccess({campaignId});
 data.set('review:'+campaignId,{...current.record,status:'CONSUMED',previous_reviews:[data.get('review:'+campaignId)]});
 const session=await workflow.exchange(campaignId,token);
 assert.equal(await workflow.authenticate(campaignId,session.sessionId,session.secret),true);
});
test('revoked or unknown email links cannot open review',async()=>{
 const {workflow,data,token,campaignId}=fixture();
 data.get('review:'+campaignId).revoked_at=10;
 await assert.rejects(workflow.exchange(campaignId,token),/REVIEW_ACCESS_DENIED/);
 await assert.rejects(workflow.exchange(campaignId,'unknown-token-long-enough-to-qualify'),/REVIEW_ACCESS_DENIED/);
});

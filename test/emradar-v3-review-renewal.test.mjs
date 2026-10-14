import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';
import {reviewPage} from '../vendor/emradar-v3/src/review-page.js';
test('consumed review can be renewed once while preserving old receipt and campaign decisions',async()=>{
 const campaign={phase:'PUBLICATION_REVIEW',decisions:{x:{decision:'REJECT'}}};
 const old={campaign_id:'v3-test',status:'CONSUMED',expires_at:2000,consumed_at:10,notification_receipt:{provider_id:'old'}};
 let review=old,version=1,sends=0;
 const adapter={read:async key=>({value:key==='v3-test'?campaign:review,version}),compareAndSwap:async(_key,v,next)=>{assert.equal(v,version);review=next;version++;return true;}};
 const flow=new ReviewWorkflow({store:{adapter},adapter,baseUrl:'https://review.example',clock:()=>1000,notify:async({campaignId,recipient})=>{sends++;return {accepted:true,provider_id:'new',campaign_id:campaignId,recipient};}});
 await flow.issue('v3-test');
 assert.equal(review.status,'NOTIFIED');assert.equal(review.previous_reviews[0].notification_receipt.provider_id,'old');assert.equal(campaign.decisions.x.decision,'REJECT');
 await assert.rejects(flow.issue('v3-test'),/ALREADY_ISSUED/);assert.equal(sends,1);
});
test('review renders saved HTML inside a sandbox without script permissions',()=>{
 assert.match(reviewPage,/preview\.setAttribute\('sandbox',''\)/);
 assert.match(reviewPage,/preview\.srcdoc=asset\.html/);
});

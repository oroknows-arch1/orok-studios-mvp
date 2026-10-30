'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareAudienceReview}=require('../src/emradar-audience-review-preview.cjs');
const {prepareDecisionPackage,recordOwnerDecision}=require('../src/emradar-audience-review-decisions.cjs');
const {createThreadExecutor}=require('../src/emradar-x-thread-executor.cjs');
const {createXThreadTransport}=require('../src/emradar-x-thread-transport.cjs');
const document={publication_state:'PUBLISHED',snapshot_date:'2026-10-30',records:[{id:'grid',title:'Grid constraint',state:'FORMING'},{id:'shipping',title:'Shipping bottleneck',state:'INVESTIGATE'}]};
function setup(){
 const review=prepareAudienceReview({document,scanUrl:'https://emradar.net/archive/2026-10-30'});
 const pkg=prepareDecisionPackage(review);
 const decisions=pkg.segments.map(s=>({sequence:s.sequence,asset_sha256:s.asset_sha256,decision:'APPROVED'}));
 const decided=recordOwnerDecision(pkg,{review_id:pkg.review_id,source_sha256:pkg.source_sha256,actor:'OWNER',decisions});
 const approved_thread={segments:decided.segments};
 return {review,pkg,decided,approved_thread};
}
test('complete thread is sequential and every record gets a linked post',async()=>{
 const {review,approved_thread}=setup();
 assert.equal(review.coverage.discovery_count,2);
 const state=new Map(),posts=[];
 const store={
  reserve:async({sequence})=>{
   if(state.get(sequence))throw Error('already reserved');
   if(sequence>1&&state.get(sequence-1)?.status!=='ACCEPTED')throw Error('parent not accepted');
   const parent_receipt_id=sequence===1?null:state.get(sequence-1).receipt_id;
   state.set(sequence,{status:'RESERVED'});return {parent_receipt_id};
  },
  record:async({sequence,receipt_id,ambiguous})=>{
   state.set(sequence,{status:ambiguous?'AMBIGUOUS':'ACCEPTED',receipt_id});return state.get(sequence);
  }
 };
 const publishPost=createXThreadTransport({accessToken:'test',fetchImpl:async(_,opts)=>{
  const body=JSON.parse(opts.body);posts.push(body);
  return {ok:true,json:async()=>({data:{id:String(100+posts.length)}})};
 }});
 const execute=createThreadExecutor({store,verifyApprovedThread:async()=>true,publishPost});
 for(let i=1;i<=approved_thread.segments.length;i++){
  const result=await execute({campaign_id:'c',sequence:i,approved_thread});
  assert.equal(result.status,'ACCEPTED');
 }
 assert.equal(posts.length,3);assert.equal(posts[0].reply,undefined);
 assert.equal(posts[1].reply.in_reply_to_tweet_id,'101');
 assert.equal(posts[2].reply.in_reply_to_tweet_id,'102');
 assert.equal(state.get(3).receipt_id,'103');
});
test('transport failure produces ambiguous state and blocks the next post',async()=>{
 const {approved_thread}=setup();
 let status='PENDING';
 const store={
  reserve:async({sequence})=>{if(sequence!==1||status!=='PENDING')throw Error('blocked');status='RESERVED';return {parent_receipt_id:null}},
  record:async({ambiguous})=>{status=ambiguous?'AMBIGUOUS':'ACCEPTED';}
 };
 const execute=createThreadExecutor({store,verifyApprovedThread:async()=>true,publishPost:async()=>{throw Error('timeout')}});
 const first=await execute({campaign_id:'c',sequence:1,approved_thread});
 assert.equal(first.status,'HALTED_AMBIGUOUS');
 await assert.rejects(()=>execute({campaign_id:'c',sequence:2,approved_thread}),/blocked/);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAudienceApprovalVerifier,sha}=require('../src/emradar-audience-approval-verifier.cjs');
const segment={sequence:1,kind:'SUMMARY',record_id:null,text:'Approved text',media:{media_ids:['123']},approval_status:'APPROVED'};
const hash=require('../src/emradar-audience-asset-hash.cjs').assetHash(segment);
const review={campaign_id:'c',review_id:'r',source_sha256:'source',segments:[{...segment,asset_sha256:hash}]};
const approval={campaign_id:'c',review_id:'r',source_sha256:'source',status:'APPROVED',actor_verified:true,approved_segment_hashes:[hash]};
function verifier(a=approval,v=review){return createAudienceApprovalVerifier({loadTrustedApproval:async()=>a,loadTrustedReview:async()=>v})}
test('matches independently loaded approval and exact text/media',async()=>{assert.equal(await verifier()({campaign_id:'c',approved_thread:{segments:[segment]}}),true)});
test('rejects caller asserted approval without trusted record',async()=>{assert.equal(await verifier(null)({campaign_id:'c',approved_thread:{segments:[segment]}}),false)});
test('rejects unverified actor',async()=>{assert.equal(await verifier({...approval,actor_verified:false})({campaign_id:'c',approved_thread:{segments:[segment]}}),false)});
test('rejects text and graphic substitution',async()=>{
 assert.equal(await verifier()({campaign_id:'c',approved_thread:{segments:[{...segment,text:'altered'}]}}),false);
 assert.equal(await verifier()({campaign_id:'c',approved_thread:{segments:[{...segment,media:{media_ids:['999']}}]}}),false);
});
test('rejects different review identity and source',async()=>{
 assert.equal(await verifier({...approval,review_id:'other'})({campaign_id:'c',approved_thread:{segments:[segment]}}),false);
 assert.equal(await verifier({...approval,source_sha256:'other'})({campaign_id:'c',approved_thread:{segments:[segment]}}),false);
});

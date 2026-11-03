'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareAudienceReview}=require('../src/emradar-audience-review-preview.cjs');
const {prepareDecisionPackage,recordOwnerDecision}=require('../src/emradar-audience-review-decisions.cjs');
const document={publication_state:'PUBLISHED',snapshot_date:'2026-10-30',records:[{id:'one',state:'FORMING'},{id:'two',state:'INVESTIGATE'}]};
const pkg=()=>prepareDecisionPackage(prepareAudienceReview({document,scanUrl:'https://emradar.net/archive/2026-10-30'}));
test('exact owner approval covers every post',()=>{
 const p=pkg(),decisions=p.segments.map(s=>({sequence:s.sequence,asset_sha256:s.asset_sha256,decision:'APPROVED'}));
 const result=recordOwnerDecision(p,{review_id:p.review_id,source_sha256:p.source_sha256,actor:'OWNER',decisions});
 assert.equal(result.state,'APPROVED_FOR_FUTURE_RELEASE');assert.equal(result.segments.length,3);
});
test('stale or modified decisions fail',()=>{
 const p=pkg(),decisions=p.segments.map(s=>({sequence:s.sequence,asset_sha256:s.asset_sha256,decision:'APPROVED'}));
 assert.throws(()=>recordOwnerDecision(p,{review_id:'stale',source_sha256:p.source_sha256,actor:'OWNER',decisions}),/STALE/);
 assert.throws(()=>recordOwnerDecision(p,{review_id:p.review_id,source_sha256:p.source_sha256,actor:'OWNER',decisions:[{...decisions[0],asset_sha256:'wrong'},...decisions.slice(1)]}),/INVALID/);
});
test('one rejection prevents complete approval',()=>{
 const p=pkg(),decisions=p.segments.map((s,i)=>({sequence:s.sequence,asset_sha256:s.asset_sha256,decision:i===1?'REJECTED':'APPROVED'}));
 assert.equal(recordOwnerDecision(p,{review_id:p.review_id,source_sha256:p.source_sha256,actor:'OWNER',decisions}).state,'REVIEWED_WITH_REJECTIONS');
});

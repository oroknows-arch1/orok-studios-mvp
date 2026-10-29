'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createVerifiedVisualReview}=require('../src/emradar-audience-verified-preview.cjs');
const {createMediaVerifier,sha256}=require('../src/emradar-audience-media-verifier.cjs');
const bytes=Buffer.from('trusted image bytes'),media={preview_url:'https://emradar.net/a.png',sha256:sha256(bytes)};
const input={campaign_id:'c',review_id:'r',source_sha256:'s',segments:[{sequence:1,kind:'SUMMARY',record_id:null,text:'Lead',media},{sequence:2,kind:'DISCOVERY',record_id:'a',text:'Finding'}]};
test('verified image bytes permit preview eligibility',async()=>{
 const verifyMedia=createMediaVerifier({loadTrustedMedia:async()=>({bytes})});
 const preview=await createVerifiedVisualReview({verifyMedia})(input);
 assert.equal(preview.ready_for_authenticated_approval,true);assert.equal(preview.media_verification[0].sha256,media.sha256);
});
test('substituted image bytes block approval eligibility',async()=>{
 const verifyMedia=createMediaVerifier({loadTrustedMedia:async()=>({bytes:Buffer.from('substitute')})});
 const preview=await createVerifiedVisualReview({verifyMedia})(input);
 assert.equal(preview.ready_for_authenticated_approval,false);assert.equal(preview.problems[0].reason,'MEDIA_HASH_MISMATCH');
});
test('verification errors fail closed',async()=>{
 const preview=await createVerifiedVisualReview({verifyMedia:async()=>{throw Error('storage unavailable')}})(input);
 assert.equal(preview.ready_for_authenticated_approval,false);
});

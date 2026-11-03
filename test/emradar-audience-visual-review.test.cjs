'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareVisualReview}=require('../src/emradar-audience-visual-review.cjs');
const base={campaign_id:'c',review_id:'r',source_sha256:'s'};
const segments=[{sequence:1,kind:'SUMMARY',text:'Lead',record_id:null},{sequence:2,kind:'DISCOVERY',text:'Finding',record_id:'a'}];
test('shows every post in order with hashes',()=>{
 const p=prepareVisualReview({...base,segments});assert.equal(p.ready_for_authenticated_approval,true);
 assert.equal(p.segments.length,2);assert.match(p.html,/Lead/);assert.match(p.html,/Finding/);assert.match(p.html,/Asset SHA-256/);
});
test('blocks approval if image preview or SHA is missing',()=>{
 const p=prepareVisualReview({...base,segments:[{...segments[0],media:{media_ids:['12']}},segments[1]]});
 assert.equal(p.ready_for_authenticated_approval,false);assert.equal(p.problems[0].reason,'GRAPHIC_PREVIEW_OR_HASH_MISSING');
});
test('renders supplied HTTPS graphic preview and rejects injected HTML',()=>{
 const p=prepareVisualReview({...base,segments:[{...segments[0],text:'<script>alert(1)</script>',media:{preview_url:'https://emradar.net/graphic.png',sha256:'a'.repeat(64)}},segments[1]]});
 assert.equal(p.ready_for_authenticated_approval,true);assert.match(p.html,/&lt;script&gt;/);assert.doesNotMatch(p.html,/<script>/);
 assert.match(p.html,/graphic.png/);
});
test('rejects omitted or out-of-order posts',()=>{
 assert.throws(()=>prepareVisualReview({...base,segments:[segments[1],segments[0]]}),/SEGMENT_INVALID/);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareAudienceReview}=require('../src/emradar-audience-review-preview.cjs');
const document={publication_state:'PUBLISHED',snapshot_date:'2026-10-30',records:[{id:'one',state:'FORMING'},{id:'two',state:'UNKNOWN'}]};
test('review preview and Grok manifest cover identical discovery IDs',()=>{
 const r=prepareAudienceReview({document,scanUrl:'https://emradar.net/scans/2026-10-30'});
 assert.equal(r.coverage.discovery_count,2);assert.deepEqual(r.coverage.record_ids,r.thread.record_ids);
 assert.equal(r.state,'PREVIEW_ONLY');assert.equal(r.thread.segments.length,3);
});
test('review identity changes when source evidence changes',()=>{
 const a=prepareAudienceReview({document,scanUrl:'https://emradar.net/scans/2026-10-30'});
 const b=prepareAudienceReview({document:{...document,records:[{id:'one',state:'CONFIRMED'},document.records[1]]},scanUrl:'https://emradar.net/scans/2026-10-30'});
 assert.notEqual(a.review_id,b.review_id);
});

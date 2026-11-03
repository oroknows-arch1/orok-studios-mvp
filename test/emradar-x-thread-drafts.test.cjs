'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {draftFullScanThread,previewThreadHtml}=require('../src/emradar-x-thread-drafts.cjs');
const doc={publication_state:'PUBLISHED',snapshot_date:'2026-10-30',records:[{id:'a',title:'Grid pressure',state:'FORMING',evidence:[{url:'https://example.org/a'}]},{id:'b',title:'<script>alert(1)</script>',status:'INVESTIGATE'}]};
test('draft includes all findings and evidence states',()=>{
 const plan=draftFullScanThread({document:doc,scanUrl:'https://emradar.net/archive/2026-10-30'});
 assert.equal(plan.segments.length,3);
 assert.match(plan.segments[1].text,/FORMING/);
 assert.match(plan.segments[2].text,/INVESTIGATE/);
 assert.match(plan.segments[1].text,/example.org/);
});
test('preview escapes untrusted discovery text',()=>{
 const plan=draftFullScanThread({document:doc,scanUrl:'https://emradar.net/archive/2026-10-30'});
 const html=previewThreadHtml(plan);
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
});
test('missing scan URL fails closed',()=>assert.throws(()=>draftFullScanThread({document:doc,scanUrl:'https://example.com/'}),/SCAN_URL/));

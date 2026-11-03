'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {draftConciseThread}=require('../src/emradar-x-thread-concise.cjs');
test('seven published discoveries produce exactly seven standalone posts',()=>{
 const document={publication_state:'PUBLISHED',snapshot_date:'2026-10-30',records:Array.from({length:7},(_,i)=>({id:'r'+i,title:'Discovery '+i,state:'FORMING',summary:'Evidence '.repeat(120),causal_chain:{consequences:['Supplier '+i+' faces higher financing costs.']},evidence:Array.from({length:20},()=>({fact:'Details'.repeat(100),url:'https://example.com'}))}))};
 const plan=draftConciseThread({document,scanUrl:'https://emradar.net/scans/2026-10-30'});
 assert.equal(plan.segments.length,7);assert.equal(new Set(plan.segments.map(x=>x.record_id)).size,7);
 for(const post of plan.segments){assert.ok(post.text.length<700);assert.match(post.text,/FORMING/);assert.match(post.text,/https:\/\/example.com/)}
});

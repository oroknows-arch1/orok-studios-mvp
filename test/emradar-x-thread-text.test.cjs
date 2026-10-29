'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {splitPost,expandSegments,validText}=require('../src/emradar-x-thread-text.cjs');
test('weighted platform limits preserve Unicode, long source URLs and complete source words',()=>{
 const url='https://example.org/'+('source/'.repeat(70));
 const source=('Causal pressure → scarcity. 👨‍👩‍👧‍👦 '.repeat(25))+url;
 const parts=splitPost(source);assert(parts.length>1);assert(parts.every(validText));assert(parts.some(part=>part.includes(url)));
 assert.equal(parts.join(' ').replace(/\s+/g,' ').trim(),source.replace(/\s+/g,' ').trim());
});
test('expanded parts preserve discovery grouping and exact reply order before review',()=>{
 const segments=expandSegments([{kind:'SUMMARY',record_id:null,text:'Summary'},{kind:'DISCOVERY',record_id:'a',text:'Evidence pressure and uncertainty. '.repeat(30),media:{sha256:'image'}}]);
 assert(segments.length>2);assert.equal(segments[1].discovery_part,1);assert.equal(segments[2].media,null);
 for(const [i,s] of segments.entries()){assert.equal(s.sequence,i+1);assert.equal(s.parent_sequence,i||null);assert(validText(s.text));}
});

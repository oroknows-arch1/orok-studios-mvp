import test from 'node:test';
import assert from 'node:assert/strict';
import {xFormationCandidates} from '../src/x-formation-fallback.js';

const document={evidence:[
 {id:'a:1',verified:true,source_url:'https://example.org/a'},
 {id:'a:2',verified:true,source_url:'https://example.org/a'},
 {id:'b:1',verified:true,source_url:'https://example.org/b'},
 {id:'c:1',verified:false,source_url:'https://example.org/c'},
 {id:'d:1',verified:true,source_url:'http://untrusted.example/d'}
]};

test('preferred X formation comes first and distinct verified fallback is retained',()=>{
 const candidates=xFormationCandidates(document,['a:1']);
 assert.deepEqual(candidates.map(item=>item.recordId),['a','b']);
 assert.deepEqual(candidates[0].evidenceIds,['a:1','a:2']);
 assert.deepEqual(candidates[0].sourceUrls,['https://example.org/a']);
 assert.deepEqual(candidates[1].evidenceIds,['b:1']);
});
test('single unavailable X source does not erase another verified candidate',()=>{
 const candidates=xFormationCandidates(document,['a:1'],2);
 const readable=new Set(['https://example.org/b']);
 assert.equal(candidates.find(item=>item.sourceUrls.some(url=>readable.has(url)))?.recordId,'b');
});
test('reject unverifiable evidence and prevent unbounded fallback',()=>{
 assert.deepEqual(xFormationCandidates({evidence:[{id:'u:1',verified:false,source_url:'https://example.org/u'}]},[]),[]);
 assert.throws(()=>xFormationCandidates(document,[],50),/X_FALLBACK_LIMIT_INVALID/);
 assert.equal(xFormationCandidates(document,[],1).length,1);
});

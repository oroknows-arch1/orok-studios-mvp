const test=require('node:test');
const assert=require('node:assert/strict');

test('X formation fallback retains a separate verified candidate',async()=>{
 const {xFormationCandidates}=await import('../vendor/emradar-v3/src/x-formation-fallback.js');
 const document={evidence:[
  {id:'a:1',verified:true,source_url:'https://example.org/a'},
  {id:'a:2',verified:true,source_url:'https://example.org/a'},
  {id:'b:1',verified:true,source_url:'https://example.org/b'},
  {id:'c:1',verified:false,source_url:'https://example.org/c'}
 ]};
 const candidates=xFormationCandidates(document,['a:1']);
 assert.deepEqual(candidates.map(item=>item.recordId),['a','b']);
 assert.deepEqual(candidates[0].evidenceIds,['a:1','a:2']);
 assert.deepEqual(candidates[1].sourceUrls,['https://example.org/b']);
 assert.equal(candidates.some(item=>item.recordId==='c'),false);
 assert.throws(()=>xFormationCandidates(document,[],9),/X_FALLBACK_LIMIT_INVALID/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../vendor/emradar-v3/src/x-formation-fallback.js');
const document={evidence:[
 {id:'a:1',verified:true,source_url:'https://example.org/a'},
 {id:'a:2',verified:true,source_url:'https://example.org/a'},
 {id:'b:1',verified:true,source_url:'https://example.org/b'},
 {id:'c:1',verified:false,source_url:'https://example.org/c'}
]};
const input={campaignId:'c',destination:{id:'x',evidence:{ids:['a:1']}},document};

test('X fallback prefers original, retains independently verified alternative, and has a bound',async()=>{
 const {xFormationCandidates}=await load();
 const candidates=xFormationCandidates(document,['a:1']);
 assert.deepEqual(candidates.map(item=>item.recordId),['a','b']);
 assert.deepEqual(candidates[0].evidenceIds,['a:1','a:2']);
 assert.deepEqual(candidates[1].sourceUrls,['https://example.org/b']);
 assert.throws(()=>xFormationCandidates(document,[],9),/X_FALLBACK_LIMIT_INVALID/);
});
test('missing primary passage tries the next verified formation without mixing facts',async()=>{
 const {writeXWithFormationFallback}=await load();let writes=0;
 const asset=await writeXWithFormationFallback({input,
  readSource:async url=>url.endsWith('/b')?{url,text:'verified source excerpt'}:null,
  write:async ({destination,sourcePages})=>{writes++;assert.deepEqual(destination.evidence.ids,['b:1']);assert.equal(sourcePages.length,1);return {kind:'X',story_record_id:'b',evidence_ids:['b:1']};}
 });
 assert.equal(writes,1);assert.equal(asset.story_record_id,'b');
});
test('no accessible primary page still prepares a scan-evidence-only X draft for manual review',async()=>{
 const {writeXWithFormationFallback}=await load();let writes=0;
 const asset=await writeXWithFormationFallback({input,readSource:async()=>null,write:async ({destination,sourcePages})=>{
  writes++;assert.deepEqual(sourcePages,[]);assert.deepEqual(destination.evidence.ids,['a:1','a:2']);
  return {kind:'X',story_record_id:'a',evidence_ids:['a:1']};
 }});
 assert.equal(writes,1);assert.equal(asset.story_record_id,'a');
});
test('provider failure does not generate repeated paid alternatives',async()=>{
 const {writeXWithFormationFallback}=await load();let writes=0;
 await assert.rejects(writeXWithFormationFallback({input,readSource:async url=>({url,text:'source'}),write:async()=>{writes++;throw Error('MODEL_PROVIDER_UNAVAILABLE');}}),/MODEL_PROVIDER_UNAVAILABLE/);
 assert.equal(writes,1);
});
test('reject a candidate whose written evidence belongs to another formation',async()=>{
 const {writeXWithFormationFallback}=await load();
 let calls=0;
 const asset=await writeXWithFormationFallback({input,
  readSource:async url=>({url,text:'source'}),
  write:async ({destination})=>{calls++;return calls===1?{story_record_id:'a',evidence_ids:['b:1']}:{story_record_id:'b',evidence_ids:destination.evidence.ids};}
 });
 assert.equal(calls,2);assert.equal(asset.story_record_id,'b');
});

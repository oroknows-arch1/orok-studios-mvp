import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeXWithFormationFallback} from '../src/x-formation-fallback.js';

const evidence={id:'story-1:notice',record_id:'story-1',verified:true,source_url:'https://example.org/notice',fact:'Approved plan exists'};
const input={destination:{id:'x',evidence:{ids:[evidence.id]}},document:{evidence:[evidence]}};

test('unavailable primary website produces scan-evidence-backed X draft, not a blocking placeholder',async()=>{
 let calls=0;
 const asset=await writeXWithFormationFallback({
  input,readSource:async()=>null,write:async ({destination,sourcePages})=>{
   calls++;
   assert.deepEqual(sourcePages,[]);
   assert.deepEqual(destination.evidence.ids,[evidence.id]);
   return {story_record_id:'story-1',evidence_ids:[evidence.id],kind:'X',body:'Proposed market consequence, pending further verification'};
  }
 });
 assert.equal(calls,1);
 assert.equal(asset.kind,'X');
});

test('scan evidence must already be verified before an X draft can be prepared',async()=>{
 const unverified=structuredClone(input);
 unverified.document.evidence[0].verified=false;
 await assert.rejects(()=>writeXWithFormationFallback({input:unverified,readSource:async()=>null,write:async()=>{throw Error('MUST_NOT_WRITE')}}),/V3_VERIFIED_SOURCE_REQUIRED/);
});

test('fallback cannot attach evidence from a different formation',async()=>{
 await assert.rejects(()=>writeXWithFormationFallback({input,readSource:async()=>null,write:async()=>({story_record_id:'different',evidence_ids:[evidence.id]})}),/X_FALLBACK_EVIDENCE_MISMATCH/);
});

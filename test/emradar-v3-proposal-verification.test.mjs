import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';

test('Verify Again requires downloaded passages for the exact draft',async()=>{
 const url='https://source.example/report';
 const evidence=[{id:'e1',fact:'Evidence',source_url:url,source:'Publisher',page_sha256:'b'.repeat(64),excerpt:'The publisher provided a source passage with the verified claim.'}];
 const asset={claim_evidence:{version:'claim-evidence-v1'},kind:'EMAIL',body:'Proposal',evidence_ids:['e1']};
 const requests=[];
 const openai={
  chat:{completions:{create:async request=>{requests.push(request);return {choices:[{message:{content:'{"supported":true}'}}]};}}},
  responses:{create:async()=>assert.fail('Verify Again cannot use search snippets as proof')}
 };
 const providers=createOpenAiPreparationProviders({openai});
 await assert.rejects(providers.investigateProposal({asset:{...asset,claim_evidence:null},evidence}),/V3_ASSET_CLAIM_EVIDENCE_REQUIRED/);
 assert.equal((await providers.investigateProposal({asset,evidence:[{...evidence[0],excerpt:null}]})).status,'INVESTIGATION_REQUIRED');
 assert.equal(requests.length,0);
 const result=await providers.investigateProposal({asset,evidence});
 assert.equal(result.status,'VERIFIED');
 assert.equal(result.claims[0].source_urls[0],url);
 assert.deepEqual(JSON.parse(requests[0].messages[1].content).draft,{body:asset.body});
 assert.throws(()=>createOpenAiPreparationProviders({proposalVerificationMaxToolCalls:7,openai}),/V3_PROPOSAL_TOOL_CALL_LIMIT_INVALID/);
});

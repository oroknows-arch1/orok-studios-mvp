import test from 'node:test';
import assert from 'node:assert/strict';
import verified from './fixtures/v3-verified-recipient.cjs';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {EDITORIAL_ENFORCEMENT_VERSION} from '../vendor/emradar-v3/src/editorial-reference.js';
const evidence=[{id:'e1',verified:true,fact:'Equipment investment, packaging partnerships, supplier development and workforce capacity are appearing together.'}];
const destination={...verified('journal',evidence),name:'Semiconductor For You',evidence:{ids:['e1']}};
const draft={subject:'What does the semiconductor supplier buildout mean?',body:'Will equipment investment, packaging partnerships and supplier development turn into commercial capacity? The cited public announcement establishes intended activity, not commercial utilisation or supplier economics. I can offer a sourced article examining the practical bottlenecks and what would demonstrate progress.',analytical_finding:'Will equipment investment, packaging partnerships and supplier development turn into commercial capacity?',limitations:'The cited public announcement establishes intended activity, not commercial utilisation or supplier economics.',story_evidence_ids:['e1']};

test('question-led first-draft outreach is retained without compulsory second rewrite',async()=>{
 let calls=0,system='';
 const provider=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async request=>{calls++;system=request.messages[0].content;return {choices:[{message:{content:JSON.stringify(draft)}}]};}}}}});
 const asset=await provider.write({campaignId:'test',destination,document:{evidence}});
 assert.equal(calls,1);
 assert.equal(asset.editorial_enforcement,EDITORIAL_ENFORCEMENT_VERSION);
 assert.match(asset.body,/Will equipment investment/);
 assert.doesNotMatch(system,/ORIGINAL OUTREACH \(verbatim\)/);
});

test('a non-template but sourced pitch is reviewable, with missing metadata clearly warned',async()=>{
 let calls=0;
 const alternative={...draft,body:'Equipment investment and partnerships are now being discussed together. The open question is which supplier constraints matter most for operating capacity. I can examine those consequences in a sourced contribution.'};
 const provider=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>{calls++;return {choices:[{message:{content:JSON.stringify(alternative)}}]};}}}}});
 const asset=await provider.write({campaignId:'test',destination,document:{evidence}});
 assert.equal(calls,1);
 assert.deepEqual(asset.evidence_ids,['e1']);
 assert.deepEqual(asset.editorial_warnings,['EVIDENCE_LIMITATION_NEEDS_REVIEW','ANALYTICAL_FINDING_NEEDS_REVIEW']);
});

test('unsupported evidence links still cannot become an editorial email',async()=>{
 const unsupported={...draft,story_evidence_ids:['not-in-scan']};
 const provider=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify(unsupported)}}]})}}}});
 await assert.rejects(provider.write({campaignId:'test',destination,document:{evidence}}),/V3_UNSUPPORTED_EDITORIAL_CONNECTION/);
});

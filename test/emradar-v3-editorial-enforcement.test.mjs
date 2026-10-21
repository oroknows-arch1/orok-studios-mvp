import test from 'node:test';
import assert from 'node:assert/strict';
import verified from './fixtures/v3-verified-recipient.cjs';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {originalOutreach,EDITORIAL_ENFORCEMENT_VERSION} from '../vendor/emradar-v3/src/editorial-reference.js';
const evidence=[{id:'e1',verified:true,fact:'Equipment investment, packaging partnerships, supplier development and workforce capacity are appearing together.'}];
const destination={...verified('journal',evidence),name:'Semiconductor For You',evidence:{ids:['e1']}};
const good={subject:'Contribution on India’s semiconductor suppliers',body:originalOutreach.slice(8,originalOutreach.indexOf('\n\nRegards,')),analytical_finding:'What stood out was not another chip-factory announcement, but equipment investment, packaging partnerships, supplier development and workforce capacity beginning to appear together.',limitations:'commercial utilisation and supplier economics',story_evidence_ids:['e1']};
for(const publication of ['Real Assets Adviser','The Africa Report'])test(`${publication} rejected analytical-memo pattern must regenerate into the sole approved progression`,async()=>{
 const bad={...good,body:'I’m Sean Walker at EMRADAR. Equipment investment shows emerging capacity constraints. We can offer insights. Would you be interested?',analytical_finding:'Equipment investment shows emerging capacity constraints.',limitations:'Capacity remains uncertain.'};
 let calls=0;const requests=[];
 const provider=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async request=>{requests.push(request);return {choices:[{message:{content:JSON.stringify(calls++===0?bad:good)}}]};}}}}});
 const result=await provider.write({campaignId:'production-shaped',destination:{...destination,name:publication},document:{evidence}});
 assert.equal(calls,2);assert.equal(result.editorial_enforcement,EDITORIAL_ENFORCEMENT_VERSION);assert(requests.every(r=>r.messages[0].content.includes(originalOutreach)));assert.match(result.body,/Would this be suitable as an article or research contribution/);
});
test('two alternative-style generations fail closed even with valid source IDs, finding and caveat',async()=>{
 const bad={...good,body:'I’m Sean Walker at EMRADAR. The evidence shows processing constraints. Capacity remains uncertain. Would an article interest you?',analytical_finding:'The evidence shows processing constraints.',limitations:'Capacity remains uncertain.'};let calls=0;
 const provider=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>{calls++;return {choices:[{message:{content:JSON.stringify(bad)}}]};}}}}});
 await assert.rejects(provider.write({campaignId:'production-shaped',destination,document:{evidence}}),/V3_EDITORIAL_PROGRESSION_REQUIRED/);assert.equal(calls,2);
});

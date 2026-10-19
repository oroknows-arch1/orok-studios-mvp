import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiPreparationProviders,correspondenceType} from '../vendor/emradar-v3/src/openai-preparation-providers.js';

const evidence={id:'e1',verified:true,fact:'Equipment investment, packaging partnerships, supplier development and workforce capacity are appearing together.',source:'Published scan',source_url:'https://source.example/fact'};
import {originalOutreach} from '../vendor/emradar-v3/src/editorial-reference.js';
const sfy={subject:'Contribution idea: India’s semiconductor ecosystem beyond the fab',body:originalOutreach.slice('Hello,\n\n'.length,originalOutreach.indexOf('\n\nRegards,')),limitations:'commercial utilisation and supplier economics'};
const openaiFor=(value,requests=[])=>({chat:{completions:{create:async request=>{requests.push(request);return {choices:[{message:{content:JSON.stringify({...value,story_evidence_ids:['e1']})}}]};}}},images:{generate:async()=>{throw Error('NOT_USED');}}});

test('approved SFY behaviour produces destination-specific connected-Earth editorial correspondence',async()=>{
 const providers=createOpenAiPreparationProviders({openai:openaiFor(sfy)});
 const asset=await providers.write({campaignId:'campaign',destination:{id:'sfy',name:'Semiconductor For You',category:'Publication',contact_verified:false,delivery_eligible:false,evidence:{ids:['e1']}},document:{evidence:[evidence],uncertainty:['Commercial utilisation remains unresolved.']}});
 assert.equal(asset.correspondence_type,'EDITORIAL_OUTREACH');
 assert.match(asset.body,/I’m Sean Walker/);assert.match(asset.body,/What|development matters/);assert.match(asset.body,/Semiconductor For You/);assert.match(asset.body,/Would this be suitable as an article or research contribution/);
 assert.match(asset.body,/Sean Walker\nEMRADAR \| Research & Editorial/);assert.equal(asset.brand_version,'connected-earth-v1');assert.equal(asset.visual,'CONNECTED_EARTH');assert.match(asset.html,/connected-earth-email-v1\.jpg/);assert.equal(asset.delivery_eligible,false);assert.equal(asset.to,null);assert.deepEqual(asset.evidence_ids,['e1']);
});

test('owner feedback reaches the pinned Semiconductor For You writer without replacing its standard',async()=>{
 const requests=[],feedback='Explain the article contribution more directly and keep the announced projects distinct from completed assets.';
 const finding='The reported shift is that supplier capacity, not equipment alone, is part of the manufacturing opportunity.';
 const limitations='The commercial utilisation of these planned investments remains uncertain.';
 const revised={subject:'A research contribution on supplier capacity',body:`I’m Sean Walker at EMRADAR. Semiconductor For You’s coverage makes this supplier question especially relevant. ${finding} A sourced article could examine how supplier development and workforce capacity affect the manufacturing opportunity. Would this be suitable as an article or research contribution? ${limitations}`,analytical_finding:finding,limitations};
 const providers=createOpenAiPreparationProviders({openai:openaiFor(revised,requests)});
 const destination={id:'sfy',name:'Semiconductor For You',category:'Publication',website:'https://sfy.example',destination_class:'EDITORIAL_PUBLICATION',active:true,publication_verified:true,editorial_fit_verified:true,contact_verified:true,delivery_eligible:true,relationship:{formation_ids:['formation-1'],industries:['semiconductor'],reason:'Verified scan evidence establishes the publication relevance.'},verification:{status:'VERIFIED',method:'live_editorial_contact_page',publication_status:'VERIFIED',publication_page_sha256:'a'.repeat(64),publication_proof_url:'https://sfy.example/about',evidence_ids:['e1'],scan_evidence_digest:'b'.repeat(64)},contact:{email:'editor@sfy.example',source_url:'https://sfy.example/contact',purpose:'editorial',published_excerpt:'Editorial contact editor@sfy.example',page_sha256:'c'.repeat(64)},evidence:{ids:['e1']}};
 const asset=await providers.write({campaignId:'campaign',destination,document:{evidence:[evidence]},ownerFeedback:feedback});
 const prompt=JSON.parse(requests[0].messages[1].content);
 assert.equal(prompt.owner_feedback,feedback);assert.match(requests[0].messages[0].content,/Semiconductor For You/);
 assert.equal(asset.editorial_reference.sha256, (await import('../vendor/emradar-v3/src/editorial-reference.js')).EDITORIAL_REFERENCE.sha256);
 assert.match(asset.body,/Would this be suitable as an article or research contribution/);
});

test('institutions are source enquiries, never editorial outreach',async()=>{
 assert.equal(correspondenceType({category:'International Finance'}),'SOURCE_ENQUIRY');
 const providers=createOpenAiPreparationProviders({openai:openaiFor({subject:'Evidence question',body:'Could you confirm whether the reported financing has reached financial close?'})});
 const asset=await providers.write({campaignId:'campaign',destination:{id:'bank',name:'World Bank',category:'International Finance',contact_verified:false,delivery_eligible:false,evidence:{ids:['e1']}},document:{evidence:[evidence]}});
 assert.equal(asset.correspondence_type,'SOURCE_ENQUIRY');assert.doesNotMatch(asset.body,/article|research contribution/i);assert.equal(asset.delivery_eligible,false);
});

test('editorial style remains an owner decision without bypassing required evidence',async()=>{
 const {createOpenAiPreparationProviders}=await import('../vendor/emradar-v3/src/openai-preparation-providers.js');
 const draft={subject:'Research contribution',introduction:'Sean Walker at EMRADAR.',observation:'Evidence shows a change. '.repeat(45),significance:'This may affect refining.',contribution:'A research contribution for Journal.',question:'Would you like to review it?',limitations:'Commercial utilisation is uncertain.'};
 const providers=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify({...draft,story_evidence_ids:['e1'],body:[draft.introduction,draft.observation,draft.significance,draft.contribution,draft.question,draft.limitations].join("\n\n")})}}]})}},images:{generate:async()=>{}}}});
 const destination={id:'journal',name:'Journal',destination_class:'EDITORIAL_PUBLICATION',evidence:{ids:['e1']},contact_verified:false,delivery_eligible:false};
 const asset=await providers.write({campaignId:'campaign',destination,document:{evidence:[{id:'e1',verified:true,fact:'Published fact'}]}});
 assert.equal(asset.kind,'EMAIL');assert.equal(asset.delivery_eligible,false);assert.equal(asset.to,null);assert.match(asset.body,/Would you like to review it/);
 await assert.rejects(providers.write({campaignId:'campaign',destination,document:{evidence:[]}}),/V3_DESTINATION_EVIDENCE_REQUIRED/);
});

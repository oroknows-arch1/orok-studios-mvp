import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiPreparationProviders,correspondenceType} from '../vendor/emradar-v3/src/openai-preparation-providers.js';

const evidence={id:'e1',verified:true,fact:'Equipment investment, packaging partnerships, supplier development and workforce capacity are appearing together.',source:'Published scan',source_url:'https://source.example/fact'};
import {originalOutreach} from '../vendor/emradar-v3/src/editorial-reference.js';
const sfy={subject:'Contribution idea: India’s semiconductor ecosystem beyond the fab',body:originalOutreach.slice('Hello,\n\n'.length,originalOutreach.indexOf('\n\nRegards,')),limitations:'commercial utilisation and supplier economics'};
const openaiFor=(value,requests=[])=>({chat:{completions:{create:async request=>{requests.push(request);return {choices:[{message:{content:JSON.stringify({...value,story_evidence_ids:['e1']})}}]};}}},images:{generate:async()=>{throw Error('NOT_USED');}}});

test('unverified publications cannot obtain deliverable correspondence even with the approved reference',async()=>{
 const providers=createOpenAiPreparationProviders({openai:openaiFor(sfy)});
 await assert.rejects(providers.write({campaignId:'campaign',destination:{id:'sfy',name:'Semiconductor For You',category:'Publication',contact_verified:false,delivery_eligible:false,evidence:{ids:['e1']}},document:{evidence:[evidence]}}),/V3_VERIFIED_RECIPIENT_REQUIRED/);
});

test('owner feedback reaches the pinned Semiconductor For You writer without replacing its standard',async()=>{
 const requests=[],feedback='Explain the article contribution more directly and keep the announced projects distinct from completed assets.';
 const finding='The reported shift is that supplier capacity, not equipment alone, is part of the manufacturing opportunity.';
 const limitations='The commercial utilisation of these planned investments remains uncertain.';
 const revised={subject:'A research contribution on supplier capacity',body:`I’m Sean Walker, working on EMRADAR.\n\nOur scan identified the supplier-capacity question. ${finding}\n\nWe are developing an article on how supplier development and workforce capacity affect the manufacturing opportunity. ${limitations}\n\nWould this be suitable as an article or research contribution? If useful, I can send a concise draft with sources for review.`,analytical_finding:finding,limitations};
 const providers=createOpenAiPreparationProviders({openai:openaiFor(revised,requests)});
 const destination={id:'sfy',name:'Semiconductor For You',category:'Publication',website:'https://sfy.example',destination_class:'EDITORIAL_PUBLICATION',active:true,publication_verified:true,editorial_fit_verified:true,contact_verified:true,delivery_eligible:true,relationship:{formation_ids:['formation-1'],industries:['semiconductor'],reason:'Verified scan evidence establishes the publication relevance.'},verification:{status:'VERIFIED',method:'live_editorial_contact_page',publication_status:'VERIFIED',publication_page_sha256:'a'.repeat(64),publication_proof_url:'https://sfy.example/about',evidence_ids:['e1'],scan_evidence_digest:'b'.repeat(64)},contact:{email:'editor@sfy.example',source_url:'https://sfy.example/contact',purpose:'editorial',published_excerpt:'Editorial contact editor@sfy.example',page_sha256:'c'.repeat(64)},evidence:{ids:['e1']}};
 const asset=await providers.write({campaignId:'campaign',destination,document:{evidence:[evidence]},ownerFeedback:feedback});
 const prompt=JSON.parse(requests[0].messages[1].content);
 assert.equal(prompt.owner_feedback,feedback);assert.match(requests[0].messages[0].content,/Semiconductor For You/);
 assert.equal(asset.editorial_reference.sha256, (await import('../vendor/emradar-v3/src/editorial-reference.js')).EDITORIAL_REFERENCE.sha256);
 assert.match(asset.body,/Would this be suitable as an article or research contribution/);
});

test('institutions and unverified editorial destinations cannot bypass the recipient requirement',async()=>{
 assert.equal(correspondenceType({category:'International Finance'}),'SOURCE_ENQUIRY');
 const providers=createOpenAiPreparationProviders({openai:openaiFor(sfy)});
 for(const destination of [{id:'bank',category:'International Finance'},{id:'journal',destination_class:'EDITORIAL_PUBLICATION'}]){
  await assert.rejects(providers.write({campaignId:'campaign',destination:{...destination,contact_verified:false,evidence:{ids:['e1']}},document:{evidence:[evidence]}}),/V3_VERIFIED_RECIPIENT_REQUIRED/);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {validateEditorialStory} from '../vendor/emradar-v3/src/editorial-reference.js';
import {emradarGraphicPrompt} from '../vendor/emradar-v3/src/graphic-standard.js';
import {CampaignPreparation} from '../vendor/emradar-v3/src/preparation.js';
import verified from './fixtures/v3-verified-recipient.cjs';

const kenyaIds=['kenya-bundibugyo-ebola-response-network:0','kenya-bundibugyo-ebola-response-network:1','kenya-bundibugyo-ebola-response-network:2'];
const bangladeshIds=['bangladesh-measles-immunization-system-failure:0','bangladesh-measles-immunization-system-failure:1','bangladesh-measles-immunization-system-failure:2'];
const evidence=[
 {id:bangladeshIds[0],record_id:'bangladesh-measles-immunization-system-failure',verified:true,fact:'Reuters reported 202,000 suspected cases, 22,000 confirmed cases and 1,147 deaths, with 94% of deaths among children under five.',source:'Reuters',source_url:'https://reuters.example/bangladesh',date:'2026-10-17'},
 {id:bangladeshIds[1],record_id:'bangladesh-measles-immunization-system-failure',verified:true,fact:'WHO launched a review covering financing, supply, cold chain, data and surveillance across all eight divisions.',source:'WHO',source_url:'https://who.example/bangladesh',date:'2026-10-04'},
 {id:bangladeshIds[2],record_id:'bangladesh-measles-immunization-system-failure',verified:true,fact:'A special campaign targeted 3.4 million missed children after 4.3 million doses arrived.',source:'BSS',source_url:'https://bss.example/bangladesh',date:'2026-09-26'},
 {id:kenyaIds[0],record_id:'kenya-bundibugyo-ebola-response-network',verified:true,fact:'Three of four new Ebola cases were health workers and all four were quarantined contacts.',source:'Africa CDC',source_url:'https://africacdc.example/kenya',date:'2026-10-17'},
 {id:kenyaIds[1],record_id:'kenya-bundibugyo-ebola-response-network',verified:true,fact:'Kenya traced 128 of 130 contacts and reported no community transmission.',source:'Africa CDC',source_url:'https://africacdc.example/kenya',date:'2026-10-17'},
 {id:kenyaIds[2],record_id:'kenya-bundibugyo-ebola-response-network',verified:true,fact:'Kenya screened 652,584 travellers and tested 267 samples across five laboratories.',source:'Kenya Ministry of Health',source_url:'https://health.example/kenya',date:'2026-10-06'}
];
const records=[
 {id:'bangladesh-measles-immunization-system-failure',theme:'Immunisation-system repair',why_surfaced:'The response expanded from emergency vaccination into a system review.',causal_chain:{pressure:['Coverage fell below the protection threshold.'],formation:['Emergency vaccination is becoming a broader immunisation-system rebuild.'],bottleneck_or_scarcity:['Cold chain, financing, data and missed children.']},contradictions:['The review is not proof that system repairs are complete.'],missing_evidence:['Review findings']},
 {id:'kenya-bundibugyo-ebola-response-network',theme:'Cross-border surveillance and frontline protection',why_surfaced:'Secondary cases reached health workers while remaining among known contacts.',causal_chain:{pressure:['Healthcare exposure creates transmission risk.'],formation:['A response network is operating under active pressure.'],bottleneck_or_scarcity:['PPE, tracing, laboratories and trained workers.']},contradictions:['High tracing coverage coexists with frontline infections.'],missing_evidence:['Healthcare-worker exposure route']}
];
const document={evidence,records};
const clientFor=drafts=>({chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify(drafts.shift())}}]})}},images:{generate:async()=>({data:[{b64_json:'aW1hZ2U='}]})}});

test('October 18 Kenya paraphrase is rejected until the pitch states a supported analytical finding',async()=>{
 const destination={...verified('africa-confidential',evidence.filter(e=>kenyaIds.includes(e.id))),name:'Africa Confidential',evidence:{ids:kenyaIds},relationship:{reason:'Covers African health crises.'}};
 const old={subject:'Kenya’s Ebola response beyond the case count',body:'Africa CDC reported seven cases. Those figures offer a way to examine tracing alongside health-worker cases. There is no evidence of community transmission.',limitations:'There is no evidence of community transmission.' ,story_evidence_ids:kenyaIds};
 const finding='The response is constrained not by case detection alone but by whether frontline protection can hold while tracing remains high.';
 const corrected={subject:'Kenya’s Ebola response: the frontline protection test',body:`${finding} Three of four new cases were health workers even though all four were known, quarantined contacts. High tracing coverage therefore measures reach, not whether exposure inside care settings is controlled. The exposure route and PPE sufficiency remain unverified. Would an evidence-backed article examining that operational gap interest Africa Confidential?`,analytical_finding:finding,limitations:'The exposure route and PPE sufficiency remain unverified.',story_evidence_ids:kenyaIds};
 const provider=createOpenAiPreparationProviders({openai:clientFor([old,corrected])});
 const asset=await provider.write({campaignId:'oct18',destination,document});
 assert.match(asset.body,/frontline protection can hold/);assert.match(asset.body,/measures reach, not whether exposure/);assert.deepEqual(asset.evidence_ids,kenyaIds);
});

test('the writer makes at most one bounded repair and still fails closed',async()=>{
 const destination={...verified('africa-confidential',evidence.filter(e=>kenyaIds.includes(e.id))),name:'Africa Confidential',evidence:{ids:kenyaIds}};
 const invalid={subject:'Counts',body:'Three of four cases were health workers.',limitations:'The route is unknown.',story_evidence_ids:kenyaIds};
 let calls=0;
 const openai={chat:{completions:{create:async()=>{calls++;return {choices:[{message:{content:JSON.stringify(invalid)}}]};}}},images:{generate:async()=>{throw Error('NOT_USED');}}};
 const provider=createOpenAiPreparationProviders({openai});
 await assert.rejects(provider.write({campaignId:'oct18',destination,document}),/V3_(?:EDITORIAL_UNCERTAINTY|ANALYTICAL_FINDING)_REQUIRED/);
 assert.equal(calls,2);
});

test('rejected drafts can be captured diagnostically without becoming campaign assets',async()=>{
 const destination={...verified('africa-confidential',evidence.filter(e=>kenyaIds.includes(e.id))),name:'Africa Confidential',evidence:{ids:kenyaIds}};
 const invalid={subject:'Counts',body:'Three of four cases were health workers.',limitations:'The route is unknown.',story_evidence_ids:kenyaIds};
 const captured=[];
 const provider=createOpenAiPreparationProviders({openai:clientFor([invalid,invalid]),onWriterDraft:async value=>captured.push(structuredClone(value))});
 await assert.rejects(provider.write({campaignId:'oct18',destination,document}),/V3_(?:EDITORIAL_UNCERTAINTY|ANALYTICAL_FINDING)_REQUIRED/);
 assert.deepEqual(captured.map(item=>item.attempt),[1,2]);
 assert.equal(captured[1].draft.body,invalid.body);
});
test('validator accepts natural inflections observed in real provider mechanisms',()=>{
 const story={evidence:[{id:'e1'}]};
 for(const analytical_finding of [
  'The review shifts ownership disclosure into a condition for continued index access.',
  'The evidence indicates that ownership transparency now affects market classification.'
 ])assert.doesNotThrow(()=>validateEditorialStory({body:`${analytical_finding} The final decision remains open.`,analytical_finding,limitations:'The final decision remains open.',story_evidence_ids:['e1']},story));
});

test('October 18 Bangladesh X uses one formation and adds analysis instead of repeating counts',async()=>{
 const finding='The outbreak is not only a vaccination-volume problem; the nationwide review shows that financing, cold chain and data are now part of the failure boundary.';
 const limitation='The review has started, but its findings and completed repairs are not yet available.';
 const provider=createOpenAiPreparationProviders({openai:clientFor([{subject:'Bangladesh measles: beyond emergency doses',body:`${finding} A campaign is targeting 3.4 million missed children while WHO reviews the system across all eight divisions. ${limitation}`,analytical_finding:finding,limitations:limitation,story_evidence_ids:bangladeshIds}])});
 const asset=await provider.write({campaignId:'oct18',destination:{id:'x',evidence:{ids:[...bangladeshIds,...kenyaIds]}},document});
 assert.deepEqual(asset.evidence_ids,bangladeshIds);assert.equal(asset.story_record_id,'bangladesh-measles-immunization-system-failure');assert.match(asset.body,/failure boundary/);assert.doesNotMatch(asset.body,/202,000 suspected/);
 const prompt=emradarGraphicPrompt({asset,document});
 assert.match(prompt,/at most three short reader-facing text blocks/);assert.doesNotMatch(prompt,/kenya-bundibugyo/);for(const item of evidence.filter(e=>bangladeshIds.includes(e.id)))assert(!prompt.includes(item.source_url));
});

test('faint or unsupported generated graphics fail before PUBLICATION_REVIEW persistence',async()=>{
 const asset={kind:'X',body:'Evidence-backed analysis with uncertainty.',subject:'Bangladesh',evidence_ids:bangladeshIds};
 const unreadable=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>({choices:[{message:{content:'{"readable":false,"unsupported_claims":false,"reason":"faint text"}'}}]})}},images:{generate:async()=>({data:[{b64_json:'aW1hZ2U='}]})}}});
 await assert.rejects(unreadable.renderVisual({asset,document}),/V3_X_VISUAL_QUALITY_FAILED/);
 const readable=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>({choices:[{message:{content:'{"readable":true,"unsupported_claims":false,"reason":"large high-contrast text"}'}}]})}},images:{generate:async()=>({data:[{b64_json:'aW1hZ2U='}]})}}});
 const rendered=await readable.renderVisual({asset:{...asset,subject:'Bangladesh',story_record_id:'bangladesh-measles-immunization-system-failure'},document});
 assert.equal(Buffer.from(rendered.base64,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});

test('graphic inspection can capture rejected bytes and the exact provider reason without weakening the gate',async()=>{
 let captured;
 const openai={chat:{completions:{create:async()=>({choices:[{message:{content:'{"readable":false,"unsupported_claims":false,"reason":"The limitation line is too small at phone-feed size."}'}}]})}},images:{generate:async()=>({data:[{b64_json:'aW1hZ2U='}]})}};
 const provider=createOpenAiPreparationProviders({openai,onVisualInspection:async value=>{captured=value;}});
 const asset={kind:'X',body:'Evidence-backed analysis with uncertainty.',subject:'Bangladesh',evidence_ids:bangladeshIds};
 await assert.rejects(provider.renderVisual({asset,document}),/V3_X_VISUAL_QUALITY_FAILED/);
 assert.equal(Buffer.from(captured.base64,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.deepEqual(captured.quality,{readable:false,unsupported_claims:false,reason:'The limitation line is too small at phone-feed size.'});
});

test('the preparation handoff cannot persist an X asset after the graphic quality gate fails',async()=>{
 let prepared=false;
 const state={phase:'DESTINATIONS_SELECTED',destinations:[{id:'x',evidence:{ids:bangladeshIds}}]};
 const preparation=new CampaignPreparation({
  store:{start:async()=> 'oct18',select:async()=>{},prepare:async()=>{prepared=true;},adapter:{read:async()=>({value:state})}},
  discover:async()=>state.destinations,
  write:async()=>({campaign_id:'oct18',destination_id:'x',kind:'X',body:'Analysis with a material limitation.',subject:'Bangladesh',evidence_ids:bangladeshIds}),
  renderVisual:async()=>{throw Error('V3_X_VISUAL_QUALITY_FAILED');}
 });
 await assert.rejects(preparation.prepare({scan:{},document}),/V3_X_VISUAL_QUALITY_FAILED/);
 assert.equal(prepared,false);
 assert.equal(state.phase,'DESTINATIONS_SELECTED');
});

import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {EDITORIAL_REFERENCE,isEditorialDestination,selectEditorialEvidence,validateEditorialStory,editorialPrompt} from './editorial-reference.js';
// Reuse the OpenAI client already configured by the existing paid API.
// No model calls occur at import or assembly time.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const brand=require('../../../src/email-brand.cjs');
export const correspondenceType=destination=>isEditorialDestination(destination)?'EDITORIAL_OUTREACH':'SOURCE_ENQUIRY';
function approvedEditorialEmail({campaignId,destination,evidence,draft,deliveryEligible}){
 if(typeof draft.subject!=='string'||!draft.subject.trim()||typeof draft.body!=='string'||!draft.body.trim()||typeof draft.limitations!=='string'||!draft.limitations.trim())throw Error('V3_EDITORIAL_DRAFT_INVALID');
 const core=draft.body.trim();
 if(!/\?/.test(core)||!(/article|research|contribution|draft/i.test(core)))throw Error('V3_EDITORIAL_PITCH_INCOMPLETE');
 const asset={campaign_id:campaignId,destination_id:destination.id,kind:'EMAIL',correspondence_type:'EDITORIAL_OUTREACH',subject:draft.subject,body:['Hello,',core,'Regards,','Sean Walker\nEMRADAR'].join('\n\n'),from:brand.identity.address,to:deliveryEligible?destination.contact.email:null,contact_status:deliveryEligible?'VERIFIED':'UNVERIFIED',delivery_eligible:deliveryEligible,evidence_ids:evidence.map(item=>item.id),evidence_limitations:draft.limitations};
 brand.brand(asset);
 return asset;
}
function sourceEnquiry({campaignId,destination,evidence,draft,deliveryEligible}){
 if(typeof draft.subject!=='string'||!draft.subject.trim()||typeof draft.body!=='string'||!draft.body.trim()||!/[?？]/.test(draft.body))throw Error('V3_SOURCE_ENQUIRY_INVALID');
 if(/\b(?:article|editorial pitch|research contribution)\b/i.test(draft.body))throw Error('V3_EDITORIAL_ROUTE_REQUIRED');
 const asset={campaign_id:campaignId,destination_id:destination.id,kind:'EMAIL',correspondence_type:'SOURCE_ENQUIRY',subject:draft.subject,body:['Hello,',"I'm Sean Walker, working on EMRADAR research.",draft.body,'Regards,','Sean Walker\nEMRADAR'].join('\n\n'),from:brand.identity.address,to:deliveryEligible?destination.contact.email:null,contact_status:deliveryEligible?'VERIFIED':'UNVERIFIED',delivery_eligible:deliveryEligible,evidence_ids:evidence.map(item=>item.id)};
 brand.brand(asset);
 return asset;
}
export function createOpenAiPreparationProviders({openai,model='gpt-6-sol',imageModel='gpt-image-1'}={}) {
 if(typeof openai?.chat?.completions?.create!=='function'||typeof openai?.images?.generate!=='function')
  throw Error('V3_OPENAI_PROVIDER_REQUIRED');
 const complete=async (system,payload)=>{
  const response=await openai.chat.completions.create({
   model,response_format:{type:'json_object'},
   messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(payload)}],max_completion_tokens:4096
  },{maxRetries:0,timeout:90000});
  console.info('V3_WRITER_USAGE '+JSON.stringify({model,usage:response.usage}));
  let parsed;
  try{parsed=JSON.parse(response.choices?.[0]?.message?.content);}catch{throw Error('V3_PROVIDER_JSON_INVALID');}
  if(!parsed || typeof parsed!=='object'||Array.isArray(parsed))throw Error('V3_PROVIDER_JSON_INVALID');
  return parsed;
 };
 return {
  researchEvidence:async({document})=>{
   if(!Array.isArray(document?.evidence)||!document.evidence.some(e=>e.verified===true))
    throw Error('V3_VERIFIED_SOURCE_REQUIRED');
   // Scanner publication attestation is the only authority for evidence verification.
   // Model-derived additions never acquire verified=true.
   return {evidence:[],source:'published_scan',status:'SOURCE_EVIDENCE_REUSED'};
  },
  write:async({campaignId,destination,document,editorialAngle})=>{
   if(destination?.id!=='x')recipientPolicy.assertVerifiedDestination(destination);
   const allowed=destination?.evidence?.ids;
   if(!Array.isArray(allowed)||!allowed.length)throw Error('V3_DESTINATION_EVIDENCE_LINK_REQUIRED');
   const evidence=(document?.evidence??[]).filter(e=>e.verified===true && allowed.includes(e.id));
   if(!evidence.length)throw Error('V3_DESTINATION_EVIDENCE_REQUIRED');
   const isX=destination.id==='x';
   const type=isX?'X':correspondenceType(destination);
   const story=type==='EDITORIAL_OUTREACH'?selectEditorialEvidence(document,allowed):null;
   const writerEvidence=story?.evidence??evidence;
   const draft=await complete(
    type==='EDITORIAL_OUTREACH'?editorialPrompt:type==='SOURCE_ENQUIRY'?'This destination is a source institution, not an editorial publication. Return JSON strings subject and body. Ask a concise evidence-specific factual question, preserve uncertainty, and do not offer an article, research contribution, editorial pitch, readership claim or relationship.': 'Write a standalone factual EMRADAR X post grounded only in supplied facts. Preserve uncertainty. Return JSON with nonempty strings body and subject. No claims beyond supplied evidence.',
    {channel:type,...(story?{editorial_reference:EDITORIAL_REFERENCE,story_record_id:story.record_id,editorial_angle:editorialAngle??null}:{}),destination:{id:destination.id,category:destination.category,name:destination.name??destination.id,relationship:destination.relationship},evidence:writerEvidence.map(e=>({id:e.id,fact:e.fact,source:e.source,url:e.source_url,date:e.date})),uncertainty:document.uncertainty??[]}
   );
   const deliveryEligible=destination.contact_verified===true && destination.delivery_eligible!==false && Boolean(destination.contact?.email);
   if(type==='EDITORIAL_OUTREACH'){
    validateEditorialStory(draft,story);
    const asset=approvedEditorialEmail({campaignId,destination,evidence:writerEvidence.filter(e=>draft.story_evidence_ids.includes(e.id)),draft,deliveryEligible});
    asset.editorial_reference=EDITORIAL_REFERENCE;asset.story_record_id=story.record_id;
    asset.recipient_verification=destination.contact;
    return asset;
   }
   if(type==='SOURCE_ENQUIRY')return sourceEnquiry({campaignId,destination,evidence,draft,deliveryEligible});
   if(typeof draft.body!=='string'||!draft.body.trim()||typeof draft.subject!=='string'||!draft.subject.trim())throw Error('V3_EDITORIAL_DRAFT_INVALID');
   return {campaign_id:campaignId,destination_id:destination.id,kind:'X',body:draft.body,subject:draft.subject,from:brand.identity.address,evidence_ids:evidence.map(e=>e.id)};
  },
  renderVisual:async({asset,document})=>{
   const evidence=(document?.evidence??[]).filter(e=>asset.evidence_ids?.includes(e.id));
   if(!evidence.length)throw Error('V3_X_EVIDENCE_REQUIRED');
   const prompt='Create one clear, editorial infographic illustrating this EMRADAR research theme. Use only grounded concepts; do not invent data, numbers, source logos or charts. Evidence: '+JSON.stringify(evidence.map(e=>e.fact))+'; accompanying X text: '+asset.body;
   const generated=await openai.images.generate({model:imageModel,prompt,size:'1024x1024'},{maxRetries:0,timeout:180000});
   const base64=generated.data?.[0]?.b64_json;
   if(typeof base64!=='string'||!base64.length)throw Error('V3_X_IMAGE_BYTES_REQUIRED');
   return {base64};
  }
 };
}

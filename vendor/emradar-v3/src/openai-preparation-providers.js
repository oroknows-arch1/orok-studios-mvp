import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {EDITORIAL_REFERENCE,isEditorialDestination,selectEditorialEvidence,validateEditorialStory,editorialPrompt} from './editorial-reference.js';
import {GRAPHIC_STANDARD,emradarGraphicPrompt} from './graphic-standard.js';
import {composeGraphicSvg} from '../../emradar-v3-authoritative/src/graphic-renderer.js';
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
export function createOpenAiPreparationProviders({openai,model='gpt-6-sol',imageModel='gpt-image-1',onWriterDraft,onVisualInspection}={}) {
 if(typeof openai?.chat?.completions?.create!=='function')
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
   const story=['EDITORIAL_OUTREACH','X'].includes(type)?selectEditorialEvidence(document,allowed):null;
   const writerEvidence=story?.evidence??evidence;
   const system=type==='EDITORIAL_OUTREACH'?editorialPrompt:type==='SOURCE_ENQUIRY'?'This destination is a source institution, not an editorial publication. Return JSON strings subject and body. Ask a concise evidence-specific factual question, preserve uncertainty, and do not offer an article, research contribution, editorial pitch, readership claim or relationship.': 'Write one standalone analytical EMRADAR X post about the supplied single formation. Return JSON strings subject, body, analytical_finding, limitations, plus story_evidence_ids. The analytical_finding must appear verbatim in body and explain the evidence-supported mechanism, constraint or change rather than paraphrasing reported figures. The limitations field must appear verbatim in body. Preserve uncertainty and do not invent conclusions. Use only supplied evidence and analysis_context.';
   const payload={channel:type,...(story?{editorial_reference:type==='EDITORIAL_OUTREACH'?EDITORIAL_REFERENCE:undefined,story_record_id:story.record_id,analysis_context:story.analysis_context,editorial_angle:editorialAngle??null}:{}),destination:{id:destination.id,category:destination.category,name:destination.name??destination.id,relationship:destination.relationship},evidence:writerEvidence.map(e=>({id:e.id,fact:e.fact,source:e.source,url:e.source_url,date:e.date})),uncertainty:document.uncertainty??[]};
   let draft=await complete(system,payload);
   if(onWriterDraft)await onWriterDraft({attempt:1,type,draft});
   if(story){
    try{validateEditorialStory(draft,story);}
    catch(error){
     if(!/^V3_(?:ANALYTICAL_FINDING_REQUIRED|EDITORIAL_UNCERTAINTY_REQUIRED|UNSUPPORTED_EDITORIAL_CONNECTION)$/.test(error.message))throw error;
     draft=await complete(system+'\nRepair the previous draft once. Correct the named validation error exactly; retain the same single formation and evidence IDs. State the analytical mechanism explicitly using natural language such as because, means, indicates, reveals, shows, shifts, depends, bottleneck, constraint, rather than, or not ... but. The analytical_finding and limitations values must each appear verbatim in body. Return the complete corrected JSON object only.',{...payload,repair_error:error.message,previous_draft:draft});
     if(onWriterDraft)await onWriterDraft({attempt:2,type,draft});
     validateEditorialStory(draft,story);
    }
   }
   const deliveryEligible=destination.contact_verified===true && destination.delivery_eligible!==false && Boolean(destination.contact?.email);
   if(type==='EDITORIAL_OUTREACH'){
    const asset=approvedEditorialEmail({campaignId,destination,evidence:writerEvidence.filter(e=>draft.story_evidence_ids.includes(e.id)),draft,deliveryEligible});
    asset.editorial_reference=EDITORIAL_REFERENCE;asset.story_record_id=story.record_id;
    asset.recipient_verification=destination.contact;
    return asset;
   }
   if(type==='SOURCE_ENQUIRY')return sourceEnquiry({campaignId,destination,evidence,draft,deliveryEligible});
   if(typeof draft.body!=='string'||!draft.body.trim()||typeof draft.subject!=='string'||!draft.subject.trim())throw Error('V3_EDITORIAL_DRAFT_INVALID');
   return {campaign_id:campaignId,destination_id:destination.id,kind:'X',body:draft.body,subject:draft.subject,from:brand.identity.address,evidence_ids:writerEvidence.filter(e=>draft.story_evidence_ids.includes(e.id)).map(e=>e.id),story_record_id:story.record_id,analytical_finding:draft.analytical_finding,evidence_limitations:draft.limitations};
  },
  renderVisual:async({asset,document})=>{
   const composed=composeGraphicSvg({asset,document});
   const {default:sharp}=await import('sharp');
   const bytes=await sharp(Buffer.from(composed.svg)).png({compressionLevel:9}).toBuffer();
   const base64=bytes.toString('base64');
   const inspection=await openai.chat.completions.create({model,response_format:{type:'json_object'},messages:[{role:'system',content:'Inspect this finished square editorial graphic. Return JSON {"readable":boolean,"unsupported_claims":boolean,"reason":string}. readable is true only when every reader-facing text element is sharp, correctly spelled, high-contrast and comfortably legible at phone-feed size; reject faint, tiny, crowded, clipped or garbled text. unsupported_claims is true if the image adds a number, causal claim, forecast or conclusion absent from the supplied caption.'},{role:'user',content:[{type:'text',text:JSON.stringify({caption:asset.body})},{type:'image_url',image_url:{url:'data:image/png;base64,'+base64,detail:'high'}}]}],max_completion_tokens:512},{maxRetries:0,timeout:90000});
   let quality;try{quality=JSON.parse(inspection.choices?.[0]?.message?.content);}catch{throw Error('V3_X_VISUAL_QUALITY_INVALID');}
   if(onVisualInspection)await onVisualInspection({base64,quality});
   if(quality?.readable!==true||quality?.unsupported_claims!==false)throw Error('V3_X_VISUAL_QUALITY_FAILED');
   return {base64,brand_version:GRAPHIC_STANDARD.version};
  }
 };
}

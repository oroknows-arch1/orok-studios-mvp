// Reuse the OpenAI client already configured by the existing paid API.
// No model calls occur at import or assembly time.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const brand=require('../../../src/email-brand.cjs');
const editorialCategory=/\b(?:news|journal|publication|media|magazine|review|editorial|research)\b/i;
export const correspondenceType=destination=>destination?.destination_class==='EDITORIAL_PUBLICATION'||editorialCategory.test(String(destination?.category??''))?'EDITORIAL_OUTREACH':'SOURCE_ENQUIRY';
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
  write:async({campaignId,destination,document})=>{
   const allowed=destination?.evidence?.ids;
   if(!Array.isArray(allowed)||!allowed.length)throw Error('V3_DESTINATION_EVIDENCE_LINK_REQUIRED');
   const evidence=(document?.evidence??[]).filter(e=>e.verified===true && allowed.includes(e.id));
   if(!evidence.length)throw Error('V3_DESTINATION_EVIDENCE_REQUIRED');
   const isX=destination.id==='x';
   const type=isX?'X':destination.destination_class==='INFORMATION_CHANNEL'?'CHANNEL_PROPOSAL':correspondenceType(destination);
   const draft=await complete(
    type==='EDITORIAL_OUTREACH'?'Write one coherent, human editorial outreach email following this proven EMRADAR correspondence approach, not a fill-in template. Return JSON strings: subject, body, limitations. The body is the complete middle of the email without greeting or signature. Benchmark from a successful EMRADAR contribution: introduce Sean Walker and EMRADAR as tracking emerging market formations from real-economy evidence; explain what stood out in a dated scan, specifically why connected developments are more interesting than a headline announcement; identify the less-visible ecosystem or market story and distinguish evidence from unresolved commercial questions; propose a concise evidence-backed article or research contribution relevant to the named publication; ask naturally whether it would be suitable, and offer a finished sourced draft if useful. Adapt the actual story, evidence and destination rather than copying the benchmark topic or wording. Write natural connected paragraphs, not isolated labelled sections. Use only supplied verified facts and uncertainties; never invent an audience, relationship, source, numbers or conclusion. The limitations JSON field must explicitly state the material unresolved issue, and the body must reflect uncertainty where it matters. No greeting, signature, URLs, generic marketing, mechanical slogans or unexplained formation-status declarations. Aim for roughly 110–180 words in the body, allowing what the evidence requires.':type==='CHANNEL_PROPOSAL'?'Write a concise evidence-backed proposal appropriate for this destination type (podcast, newsletter, business platform, social community or forum). Return JSON strings subject and body. State the verified economic story and uncertainty, why it fits the destination, and ask which submission or participation route is suitable. Do not assume permission to publish or an existing relationship.':type==='SOURCE_ENQUIRY'?'This destination is a source institution, not an editorial publication. Return JSON strings subject and body. Ask a concise evidence-specific factual question, preserve uncertainty, and do not offer an article, research contribution, editorial pitch, readership claim or relationship.': 'Write a standalone factual EMRADAR X post grounded only in supplied facts. Preserve uncertainty. Return JSON with nonempty strings body and subject. No claims beyond supplied evidence.',
    {channel:type,destination:{id:destination.id,category:destination.category,name:destination.name??destination.id,relationship:destination.relationship},evidence:evidence.map(e=>({id:e.id,fact:e.fact,source:e.source,url:e.source_url,date:e.date})),uncertainty:document.uncertainty??[]}
   );
   const deliveryEligible=destination.contact_verified===true && destination.delivery_eligible!==false && Boolean(destination.contact?.email);
   if(type==='EDITORIAL_OUTREACH')return approvedEditorialEmail({campaignId,destination,evidence,draft,deliveryEligible});
   if(type==='SOURCE_ENQUIRY'||type==='CHANNEL_PROPOSAL')return sourceEnquiry({campaignId,destination,evidence,draft,deliveryEligible});
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

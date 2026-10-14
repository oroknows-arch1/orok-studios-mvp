// Reuse the OpenAI client already configured by the existing paid API.
// No model calls occur at import or assembly time.
export function createOpenAiPreparationProviders({openai,model='gpt-4.1-mini',imageModel='gpt-image-1'}={}) {
 if(typeof openai?.chat?.completions?.create!=='function'||typeof openai?.images?.generate!=='function')
  throw Error('V3_OPENAI_PROVIDER_REQUIRED');
 const complete=async (system,payload)=>{
  const response=await openai.chat.completions.create({
   model,response_format:{type:'json_object'},temperature:0,
   messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(payload)}]
  },{maxRetries:0,timeout:90000});
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
   const draft=await complete(
    'Write concise, original, human EMRADAR correspondence grounded ONLY in supplied facts. Never invent developments, sources, contact names or editorial capabilities. Preserve uncertainty. For EMAIL include greeting, why relevant to the specific outlet, an explicit article/research contribution question, and Sean Walker / EMRADAR signature. For X write a standalone factual post. Return JSON with nonempty strings body and subject. No claims beyond supplied evidence.',
    {channel:isX?'X':'EMAIL',destination:{id:destination.id,category:destination.category,name:destination.name??destination.id},evidence:evidence.map(e=>({id:e.id,fact:e.fact,source:e.source,url:e.source_url,date:e.date})),uncertainty:document.uncertainty??[]}
   );
   if(typeof draft.body!=='string'||!draft.body.trim()||typeof draft.subject!=='string'||!draft.subject.trim())throw Error('V3_EDITORIAL_DRAFT_INVALID');
   const deliveryEligible=destination.contact_verified===true && destination.delivery_eligible!==false && Boolean(destination.contact?.email);
   return {campaign_id:campaignId,destination_id:destination.id,kind:isX?'X':'EMAIL',body:draft.body,subject:draft.subject,from:'sean@emradar.net',...(isX?{}:{to:deliveryEligible?destination.contact.email:null,contact_status:deliveryEligible?'VERIFIED':'UNVERIFIED',delivery_eligible:deliveryEligible}),evidence_ids:evidence.map(e=>e.id)};
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

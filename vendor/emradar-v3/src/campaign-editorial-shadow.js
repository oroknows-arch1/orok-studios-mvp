import {createHash} from 'node:crypto';
// Optional read-only whole-campaign editorial audit. Does not approve, edit, send or publish.
export function buildCampaignEditorialPacket(state) {
 const destinations=new Map((state?.destinations??[]).map(d=>[d.id,d]));
 return Object.entries(state?.assets??{}).filter(([,entry])=>entry?.asset?.body).map(([id,entry])=>{
  const a=entry.asset,d=destinations.get(id),ids=new Set(d?.evidence?.ids??[]);
  const sourceUrls=[...new Set((state?.preparation_input?.document?.evidence??[])
   .filter(e=>ids.has(e.id)&&e.verified===true&&typeof e.source_url==='string').map(e=>e.source_url))];
  const sourceFacts=(state?.preparation_input?.document?.evidence??[])
   .filter(e=>ids.has(e.id)&&e.verified===true&&typeof e.fact==='string')
   .slice(0,12).map(e=>e.fact.slice(0,350));
  return {id,fingerprint:entry.fingerprint,outlet:id==='x'?'X':d?.name??'Unknown outlet',subject:a.subject??'',body:a.body,sourceUrls,sourceFacts};
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
const verdicts=new Set(['READY','CORRECT','INVESTIGATE','DROP']);
export async function auditCampaignInShadow({state,request,model,googleSearch=true,timeoutMs=45000}) {
 if(typeof request!=='function')return {status:'NOT_CONFIGURED'};
 const packet=buildCampaignEditorialPacket(state);
 if(!packet.length)return {status:'NO_PROPOSALS'};
 const fingerprints=new Map(packet.map(row=>[row.id,row.fingerprint]));
 const payload={model,input:'Work as an independent upstream editor alongside EMRADAR V3. Review this full campaign using ONLY the provided verified source facts: challenge unsupported factual premises, incorrect milestones, duplication and mismatch between the proposed article and deliverable evidence. Distinguish a factual assertion lacking proof from a clearly qualified theory, open question or emerging formation; uncertainty is legitimate when its limits are explicit in the actual recipient-facing body. Judge whether the publication would receive an original, compelling EMRADAR angle and a sourced article that can fulfil precisely what the pitch promises. Recommend CORRECT when narrowing or qualifying language can rescue the story; INVESTIGATE when essential facts remain unresolved; DROP only when no useful evidence-backed article angle survives. Do not claim to have opened URLs unless Google Search is enabled. Do not approve or send. Return one result per ID, with a concrete proposed correction where needed.\n'+JSON.stringify(packet),
  ...(googleSearch?{tools:[{type:'google_search'}]}:{}),store:false,response_format:{type:'text',mime_type:'application/json',schema:{
   type:'object',properties:{proposals:{type:'array',items:{type:'object',properties:{
    id:{type:'string'},verdict:{type:'string',enum:[...verdicts]},reason:{type:'string'},correction:{type:'string'},sourceUrls:{type:'array',items:{type:'string'}}
   },required:['id','verdict','reason','correction','sourceUrls']}}},required:['proposals']}}};
 // Free Gemini 3.x review uses supplied evidence without Google Search; paid Search must be opted in.
 // Gemini 2.5 accepts Google Search grounding OR structured output, not both.
 // Request JSON in normal text mode and validate all returned IDs locally.
 if(googleSearch&&/^gemini-2\.5-/.test(model??'')){
  delete payload.response_format;
  payload.input='Return ONLY a JSON object with a "proposals" array; each row must have id, verdict (READY/CORRECT/INVESTIGATE/DROP), reason, correction, sourceUrls (URL strings). Exactly one row per supplied id. No markdown. Search for contradictory primary evidence.\\n'+payload.input;
 }
 try {
  const response=await request(payload,AbortSignal.timeout(timeoutMs)),rows=response?.proposals;
  if(!Array.isArray(rows)||rows.length!==packet.length)return {status:'UNUSABLE_AUDIT'};
  const seen=new Set();
  for(const row of rows){
   if(!fingerprints.has(row?.id)||seen.has(row.id)||!verdicts.has(row.verdict)||
    typeof row.reason!=='string'||!row.reason.trim()||typeof row.correction!=='string'||
    !Array.isArray(row.sourceUrls)||row.sourceUrls.some(url=>typeof url!=='string'))return {status:'UNUSABLE_AUDIT'};
   seen.add(row.id);
  }
  return {status:'ADVISORY',proposalCount:packet.length,verdicts:rows.map(row=>({...row,fingerprint:fingerprints.get(row.id)}))};
 }catch(error){
  const message=String(error?.message??'');
  const classified=/^GEMINI_AUDIT_(?:HTTP_[0-9]{3}|NOT_COMPLETED|EMPTY_OUTPUT|INVALID_JSON)$/.test(message)
   ?message:(error?.name==='TimeoutError'?'TIMEOUT':'REQUEST_FAILED');
  return {status:'AUDITOR_UNAVAILABLE',errorType:classified};
 }
}

/**
 * One independent editorial attempt per exact set of saved campaign assets.
 * Stores advisory findings separately. Never changes approvals, assets or deliveries.
 */
export async function auditCampaignOnce({adapter,campaignId,state,request,model,googleSearch=false}) {
 const packet=buildCampaignEditorialPacket(state);
 if(!packet.length)return {status:'NO_PROPOSALS'};
 const digest=createHash('sha256').update(JSON.stringify(packet.map(p=>[p.id,p.fingerprint]))).digest('hex');
 const key='v3-google-shadow:'+campaignId+':'+digest;
 const previous=await adapter.read(key);
 if(previous)return {status:'ALREADY_ATTEMPTED',recordKey:key};
 const reserved=await adapter.compareAndSwap(key,null,{
  status:'STARTED',campaign_id:campaignId,asset_digest:digest,created_at:new Date().toISOString()
 });
 if(!reserved)return {status:'ALREADY_ATTEMPTED',recordKey:key};
 const audit=await auditCampaignInShadow({state,request,model,googleSearch,timeoutMs:90000});
 const counts={};
 for(const row of audit.verdicts??[])counts[row.verdict]=(counts[row.verdict]??0)+1;
 await adapter.compareAndSwap(key,1,{
  status:audit.status,campaign_id:campaignId,asset_digest:digest,model,
  google_search_enabled:googleSearch,checked:audit.proposalCount??0,counts,
  outcomes:audit.verdicts??[],error_type:audit.errorType??null,
  completed_at:new Date().toISOString()
 });
 return {status:audit.status,checked:audit.proposalCount??0,counts,recordKey:key};
}

// Optional read-only whole-campaign editorial audit. Does not approve, edit, send or publish.
export function buildCampaignEditorialPacket(state) {
 const destinations=new Map((state?.destinations??[]).map(d=>[d.id,d]));
 return Object.entries(state?.assets??{}).filter(([,entry])=>entry?.asset?.body).map(([id,entry])=>{
  const a=entry.asset,d=destinations.get(id),ids=new Set(d?.evidence?.ids??[]);
  const sourceUrls=[...new Set((state?.preparation_input?.document?.evidence??[])
   .filter(e=>ids.has(e.id)&&e.verified===true&&typeof e.source_url==='string').map(e=>e.source_url))];
  return {id,fingerprint:entry.fingerprint,outlet:id==='x'?'X':d?.name??'Unknown outlet',subject:a.subject??'',body:a.body,sourceUrls};
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
const verdicts=new Set(['READY','CORRECT','INVESTIGATE','DROP']);
export async function auditCampaignInShadow({state,request,model,timeoutMs=45000}) {
 if(typeof request!=='function')return {status:'NOT_CONFIGURED'};
 const packet=buildCampaignEditorialPacket(state);
 if(!packet.length)return {status:'NO_PROPOSALS'};
 const fingerprints=new Map(packet.map(row=>[row.id,row.fingerprint]));
 const payload={model,input:'Independently audit this entire campaign as one package. Assess original sources, contradictory claims, duplicate pitches, recipient fit and writing. Do not approve or send. Return one result per ID.\n'+JSON.stringify(packet),
  tools:[{type:'google_search'}],store:false,response_format:{type:'text',mime_type:'application/json',schema:{
   type:'object',properties:{proposals:{type:'array',items:{type:'object',properties:{
    id:{type:'string'},verdict:{type:'string',enum:[...verdicts]},reason:{type:'string'},correction:{type:'string'},sourceUrls:{type:'array',items:{type:'string'}}
   },required:['id','verdict','reason','correction','sourceUrls']}}},required:['proposals']}}};
 // Gemini 2.5 accepts Google Search grounding OR structured output, not both.
 // Request JSON in normal text mode and validate all returned IDs locally.
 if(/^gemini-2\.5-/.test(model??'')){
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
 }catch(error){return {status:'AUDITOR_UNAVAILABLE',errorType:error?.name==='TimeoutError'?'TIMEOUT':'REQUEST_FAILED'};}
}

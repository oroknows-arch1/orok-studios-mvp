// Actual Google Gemini Interactions API transport for optional campaign-level audit.
// No network call at import. Key remains server-side, never included in review packets.
export function createGeminiEditorialRequest({apiKey,fetchImpl=fetch,endpoint='https://generativelanguage.googleapis.com/v1beta/interactions'}={}) {
 if(typeof apiKey!=='string'||!apiKey.trim())throw Error('GEMINI_API_KEY_REQUIRED');
 return async function request(payload,signal) {
  const response=await fetchImpl(endpoint,{method:'POST',headers:{
   'Content-Type':'application/json','x-goog-api-key':apiKey
  },body:JSON.stringify(payload),signal});
  if(!response.ok)throw Error('GEMINI_AUDIT_HTTP_'+response.status);
  const data=await response.json();
  if(data.status!=='completed')throw Error('GEMINI_AUDIT_NOT_COMPLETED');
  const output=(data.steps??[]).filter(step=>step.type==='model_output')
   .flatMap(step=>step.content??[]).filter(item=>item.type==='text'&&typeof item.text==='string')
   .map(item=>item.text).join('\n');
  if(!output.trim())throw Error('GEMINI_AUDIT_EMPTY_OUTPUT');
  let parsed;
  try{parsed=JSON.parse(output);}catch{throw Error('GEMINI_AUDIT_INVALID_JSON');}
  return parsed;
 };
}

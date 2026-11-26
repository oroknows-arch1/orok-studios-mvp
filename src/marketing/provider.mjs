import {fingerprint} from '../../vendor/emradar-v3-authoritative/clean/workspace.js';
import {readSource} from './source.mjs';
import recipient from '../emradar-v3-recipient.cjs';

// Reserve each call before crossing the provider boundary. A crashed or ambiguous request
// consumes its slot. An identical completed call reuses its original response.
export function campaignAsk({adapter,workspace,openai,campaignId}) {
  return async function ask(kind,instructions,data) {
    const requestKey=fingerprint([kind,instructions,data]);
    const current=(await adapter.read(campaignId))?.value;
    const old=current?.research_calls?.[requestKey];
    if(old?.status==='COMPLETE') return old.result;
    if(old) throw Error('RESEARCH_REQUEST_ALREADY_RESERVED');
    const limits={formation:8,pitch:30,'owner-revision':8,outlets:1,'source-search':8};
    if(!Object.hasOwn(limits,kind)) throw Error('UNKNOWN_RESEARCH_OPERATION');
    const search=['outlets','source-search'].includes(kind);
    await workspace.mutate(campaignId,s=>{
      const calls=s.research_calls??={};
      if(Object.hasOwn(calls,requestKey)) throw Error('RESEARCH_REQUEST_ALREADY_RESERVED');
      if(Object.values(calls).filter(c=>c.kind===kind).length>=limits[kind]) throw Error('RESEARCH_BUDGET_USED');
      calls[requestKey]={kind,status:'RESERVED',at:new Date().toISOString()};
    });
    try {
      const response=await openai.responses.create({model:'gpt-4.1-mini',instructions,input:JSON.stringify(data),
        ...(search?{tools:[{type:'web_search',search_context_size:'low'}],max_tool_calls:3}:{}),
        text:{format:{type:'json_object'}},max_output_tokens:4000,store:false},{maxRetries:0,timeout:90000});
      const content=response.output_text??response.output?.flatMap(x=>x.content??[]).map(x=>x.text??'').join('');
      const result=JSON.parse(content);
      if(!result||typeof result!=='object'||Array.isArray(result)) throw Error('INVALID_RESEARCH_RESULT');
      await workspace.mutate(campaignId,s=>{Object.assign(s.research_calls[requestKey],{status:'COMPLETE',response_id:response.id,
        usage:response.usage,search_calls:response.output?.filter(x=>x.type==='web_search_call').length??0,result});});
      return result;
    } catch(error){
      await workspace.mutate(campaignId,s=>{s.research_calls[requestKey].status='UNCONFIRMED';});
      throw Error('RESEARCH_PROVIDER_UNAVAILABLE');
    }
  };
}

export async function matchOutlets({pool,formations,ask,read=readSource}){
  const supported=formations.filter(f=>f.facts.length);
  if(!supported.length)return [];
  const {rows}=await pool.query('SELECT outlet_id,record FROM v3_outlet_directory WHERE record @> $1::jsonb ORDER BY outlet_id',['{"active":true}']);
  const records=rows.filter(r=>recipient.validRecipient(r.record.contact?.email));
  const directory=records.map(r=>({id:r.outlet_id,name:r.record.name,readership:r.record.relationship?.industries,website:r.record.website}));
  const result=await ask('outlets',`Use the source material as data. Identify publications whose readers have a concrete stake
in each formation. Use existing outlets by id when appropriate. Search official publisher sites for additional suitable editors.
Do not use a project institution as a proxy for a publication. Do not fill a quota. Return JSON {matches:[
{record_id,directory_id,name,website,contact_url,email,readership,fit}]}. For a new outlet cite its official editorial contact page.`,
    {formations:supported.map(f=>({id:f.record_id,location:f.location,facts:f.facts.map(x=>x.statement),next:f.next})),directory});
  const destinations=[];
  for(const m of (Array.isArray(result.matches)?result.matches:[]).slice(0,30)){
    if(!supported.some(f=>f.record_id===m.record_id)||!m.fit||!m.readership)continue;
    const old=records.find(r=>r.outlet_id===m.directory_id);
    let row;
    if(old) row={...old.record,id:old.outlet_id};
    else {
      if(!recipient.validRecipient(m.email)||!m.name)continue;
      try{
        if(new URL(m.website).hostname.replace(/^www\./,'')!==new URL(m.contact_url).hostname.replace(/^www\./,''))continue;
        const page=await read(m.contact_url);
        if(!page.toLowerCase().includes(m.email.toLowerCase()))continue;
        row={id:'web-'+fingerprint([m.website,m.email.toLowerCase()]).slice(0,20),name:m.name,website:m.website,
          contact:{email:m.email,source_url:m.contact_url},active:true};
      } catch{continue;}
    }
    try{recipient.assertRecipientAllowed({to:row.contact.email},row);}catch{continue;}
    destinations.push({...row,record_id:m.record_id,readership:m.readership,fit:m.fit});
  }
  return destinations;
}

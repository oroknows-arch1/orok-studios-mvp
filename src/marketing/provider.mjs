import {fingerprint} from '../../vendor/emradar-v3-authoritative/clean/workspace.js';
import {readSource} from './source.mjs';
import {spending} from './budget.mjs';
import recipient from '../emradar-v3-recipient.cjs';

// Reserve each call before crossing the provider boundary. A crashed or ambiguous request
// consumes its slot. An identical completed call reuses its original response.
export function campaignAsk({adapter,workspace,openai,campaignId,budget=spending(adapter)}) {
  return async function ask(kind,instructions,data) {
    const requestKey=fingerprint([kind,instructions,data]);
    const current=(await adapter.read(campaignId))?.value;
    const old=current?.research_calls?.[requestKey];
    if(old?.status==='COMPLETE') return old.result;
    if(old) throw Error('RESEARCH_REQUEST_ALREADY_RESERVED');
    const limits={formation:8,pitch:30,editorial:1,'owner-revision':8,outlets:8,'source-search':8};
    if(!Object.hasOwn(limits,kind)) throw Error('UNKNOWN_RESEARCH_OPERATION');
    const search=['outlets','source-search'].includes(kind);
    await workspace.mutate(campaignId,s=>{
      const calls=s.research_calls??={};
      if(Object.hasOwn(calls,requestKey)) throw Error('RESEARCH_REQUEST_ALREADY_RESERVED');
      if(Object.values(calls).filter(c=>c.kind===kind).length>=limits[kind]) throw Error('RESEARCH_BUDGET_USED');
      calls[requestKey]={kind,status:'RESERVED',at:new Date().toISOString()};
    });
    let reservation;
    try {
      reservation=await budget.reserve(campaignId,requestKey,instructions+JSON.stringify(data),search?3:0,kind);
    } catch(error){
      await workspace.mutate(campaignId,s=>{delete s.research_calls[requestKey];});
      throw error;
    }
    try {
      const response=await openai.responses.create({model:'gpt-4.1-mini',instructions,input:JSON.stringify(data),
        ...(search?{tools:[{type:'web_search',search_context_size:'low'}],max_tool_calls:3}:{}),
        text:{format:{type:'json_object'}},max_output_tokens:4000,store:false},{maxRetries:0,timeout:90000});
      await budget.settle(reservation,response.usage,response.output?.filter(x=>x.type==='web_search_call').length??0);
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
          contact:{email:m.email,source_url:m.contact_url,page_sha256:fingerprint(page)},active:true};
      } catch{continue;}
    }
    try{recipient.assertRecipientAllowed({to:row.contact.email},row);}catch{continue;}
    const opted=await pool.query("SELECT 1 FROM v3_outlet_directory WHERE lower(record->'contact'->>'email')=lower($1) AND (record @> '{\"opted_out\":true}' OR record @> '{\"do_not_contact\":true}' OR record->'contact' @> '{\"opted_out\":true}' OR record->'contact' @> '{\"do_not_contact\":true}') LIMIT 1",[row.contact.email]);
    if(opted.rows.length)continue;
    if(!old)await pool.query('INSERT INTO v3_outlet_directory(outlet_id,record) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[row.id,JSON.stringify(row)]);
    destinations.push({...row,record_id:m.record_id,readership:m.readership,fit:m.fit});
  }
  return destinations;
}

export async function correctCopy(state,ask,email,render){
  const entries=Object.entries(state.assets),changes=[],warnings=[];
  const drafts=entries.map(([id,{asset}])=>({id,kind:asset.kind,subject:asset.subject,body:asset.body,
    readership:state.destinations.find(d=>d.id===id)?.readership,formation_ids:asset.formation_ids}));
  const result=await ask('editorial',`Perform one internal copy edit. Use the sourced passages, check the final wording,
readership, stage of finance, attribution and original causal reasoning. Correct a mistaken premise in place. Where evidence
ends, state the uncertainty or frame the question. Do not decide release, grade recipients, add capability claims or invent
a requirement. For X retain the stated country and every connected actor with its qualification.
Return JSON {corrections:[{id,subject,body,reason}],notes:[string]}. Omit already sound drafts.`,{drafts,research:state.research});
  for(const item of (Array.isArray(result.corrections)?result.corrections:[])){
    if(!Object.hasOwn(state.assets,item.id)||!item.body?.trim()||!item.reason)continue;
    const entry=state.assets[item.id];let asset={...entry.asset,body:item.body};
    if(asset.kind==='EMAIL')asset=email({...asset,subject:item.subject?.trim()||asset.subject});
    else {
      const rows=asset.formation_ids.map(id=>state.research[id]);
      if(rows.some(r=>![r.location,...r.actors].every(label=>item.body.includes(label)))){
        warnings.push({destination_id:item.id,reason:'Copy suggestion omitted a scan attribution; original retained.'});continue;
      }
      Object.assign(asset,await render([{location:state.scan.snapshot_date,actors:[],facts:[{statement:item.body}]}],state.scan));
    }
    changes.push({id:item.id,asset,before:entry.fingerprint,reason:item.reason});
  }
  for(const note of (Array.isArray(result.notes)?result.notes:[]))if(typeof note==='string')warnings.push({stage:'internal copy review',reason:note});
  return {changes,warnings};
}

import {fingerprint} from '../../vendor/emradar-v3-authoritative/clean/workspace.js';
import {readSource} from './source.mjs';
import {spending} from './budget.mjs';
import recipient from '../emradar-v3-recipient.cjs';

function resultFromResponse(kind,response){
  const output=response.output??[];
  const content=response.output_text||output.flatMap(x=>x.content??[]).map(x=>x.text??'').join('\n');
  let value;
  // Some search-enabled responses wrap the requested object in prose or append citations.
  for(let start=content.indexOf('{');start>=0&&!value;start=content.indexOf('{',start+1)){
    let depth=0,quoted=false,escaped=false;
    for(let i=start;i<content.length;i++){
      const char=content[i];
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"'){quoted=true;continue;}
      if(char==='{')depth++;
      if(char==='}'&&--depth===0){try{value=JSON.parse(content.slice(start,i+1));}catch{}break;}
    }
  }
  if(kind==='source-search'){
    const cited=output.flatMap(item=>[...(item.action?.sources??[]),...(item.content??[]).flatMap(c=>c.annotations??[])])
      .map(c=>c.url).filter(Boolean);
    return {urls:[...new Set([...(Array.isArray(value?.urls)?value.urls:[]),...cited,...(content.match(/https:\/\/[^\s<>"\]]+/g)??[])])]
      .filter(url=>typeof url==='string'&&url.startsWith('https://')).map(url=>url.replace(/[),.;]+$/,''))};
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('RESEARCH_RESPONSE_UNREADABLE');
  return value;
}

// Reserve each call before crossing the provider boundary. A crashed or ambiguous request
// consumes its slot. An identical completed call reuses its original response.
export function campaignAsk({adapter,workspace,openai,campaignId,budget=spending(adapter)}) {
  return async function ask(kind,instructions,data) {
    const search=kind==='source-search';
    const previousKey=fingerprint([kind,instructions,data]);
    const requestKey=search?fingerprint(['search-text-json-v1',kind,instructions,data]):previousKey;
    const current=(await adapter.read(campaignId))?.value;
    const old=current?.research_calls?.[requestKey];
    if(old?.status==='COMPLETE') return old.result;
    if(old && !(old.status==='REJECTED'&&old.reason==='RESEARCH_PROVIDER_HTTP_429'&&
        Date.now()-Date.parse(old.at)>3600000))throw Error(old.reason||'RESEARCH_REQUEST_ALREADY_RESERVED');
    const limits={formation:8,pitch:30,editorial:1,'owner-revision':8,outlets:8,'source-search':8};
    if(!Object.hasOwn(limits,kind)) throw Error('UNKNOWN_RESEARCH_OPERATION');
    // The old web-search plus JSON-mode combination is rejected by the API before execution.
    // Preserve the failed request and replace just this unsupported wire format.
    if(search && current?.research_calls?.[previousKey]?.status==='UNCONFIRMED'){
      await budget.rejected?.(campaignId,previousKey);
      await workspace.mutate(campaignId,s=>{
        if(s.research_calls[previousKey]?.status==='UNCONFIRMED')
          Object.assign(s.research_calls[previousKey],{status:'REJECTED',reason:'UNSUPPORTED_SEARCH_FORMAT'});
      });
    }
    await workspace.mutate(campaignId,s=>{
      const calls=s.research_calls??={};
      if(Object.hasOwn(calls,requestKey)&&!(old?.status==='REJECTED'&&calls[requestKey].status==='REJECTED'&&calls[requestKey].at===old.at)) throw Error('RESEARCH_REQUEST_ALREADY_RESERVED');
      if(Object.values(calls).filter(c=>c.kind===kind&&c.status!=='REJECTED').length>=limits[kind]) throw Error('RESEARCH_BUDGET_USED');
      calls[requestKey]={kind,status:'RESERVED',at:new Date().toISOString()};
    });
    let reservation;
    try {
      reservation=await budget.reserve(campaignId,requestKey,instructions+JSON.stringify(data),search?3:0,kind,current?.scan?.snapshot_date);
    } catch(error){
      await workspace.mutate(campaignId,s=>{delete s.research_calls[requestKey];});
      throw error;
    }
    try {
      const response=await openai.responses.create({model:'gpt-4.1-mini',instructions,input:JSON.stringify(data),
        ...(search?{tools:[{type:'web_search',search_context_size:'low'}],max_tool_calls:3,include:['web_search_call.action.sources']}:{}),
        ...(search?{}:{text:{format:{type:'json_object'}}}),max_output_tokens:4000,store:false},{maxRetries:0,timeout:90000});
      await budget.settle(reservation,response.usage,response.output?.filter(x=>x.type==='web_search_call').length??0);
      const result=resultFromResponse(kind,response);
      await workspace.mutate(campaignId,s=>{Object.assign(s.research_calls[requestKey],{status:'COMPLETE',response_id:response.id,
        usage:response.usage,search_calls:response.output?.filter(x=>x.type==='web_search_call').length??0,result});});
      return result;
    } catch(error){
      const definite=[400,401,403,404,422,429].includes(error.status);
      const reason=definite?'RESEARCH_PROVIDER_HTTP_'+error.status:error.message==='RESEARCH_RESPONSE_UNREADABLE'?'RESEARCH_RESPONSE_UNREADABLE':'RESEARCH_PROVIDER_UNAVAILABLE';
      if(definite)await budget.rejected?.(campaignId,requestKey);
      await workspace.mutate(campaignId,s=>{Object.assign(s.research_calls[requestKey],{
        status:definite?'REJECTED':'UNCONFIRMED',reason,at:new Date().toISOString()});});
      throw Error(reason);
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
in each formation. Use existing outlets by id when appropriate. Suggest additional editors only with a known official contact page. The application independently opens that page to verify the address.
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

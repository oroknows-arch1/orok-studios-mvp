import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
const digest=value=>createHash('sha256').update(value).digest('hex');
const blockedHosts=new Set(['localhost','127.0.0.1','0.0.0.0','::1']);
function publicHttps(raw){
 try{
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port||blockedHosts.has(u.hostname)||!u.hostname.includes('.')||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal'))return null;
  return u;
 }catch{return null;}
}
async function publiclyResolved(hostname,resolver){
 if(isIP(hostname))return false;
 try{
  const addresses=await resolver(hostname,{all:true,verbatim:true});
  if(!addresses.length)return false;
  return addresses.every(({address})=>{
   if(isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===192&&p[1]===0)||(p[0]===198&&p[1]===18)||(p[0]===198&&p[1]===19));}
   if(isIP(address)===6)return !/^(::|fc|fd|fe8|fe9|fea|feb|2001:db8)/i.test(address);
   return false;
  });
 }catch{return false;}
}
function plainText(response){
 return (response.output??[]).flatMap(item=>item.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
}
export function createAutonomousOutletDiscovery({openai,directory,fetcher=fetch,resolver=lookup,model='gpt-4.1-mini',limit=29}={}){
 if(typeof openai?.responses?.create!=='function'||typeof directory?.upsert!=='function'||typeof fetcher!=='function')throw Error('AUTONOMOUS_DISCOVERY_DEPENDENCIES_REQUIRED');
 return async ({document})=>{
  const evidence=(document?.evidence??[]).filter(e=>e?.verified===true&&e?.id&&e?.fact&&e?.source_url);
  if(!evidence.length)throw Error('DISCOVERY_VERIFIED_EVIDENCE_REQUIRED');
  const answer=await openai.responses.create({
   model,tools:[{type:'web_search'}],tool_choice:'required',
   input:[{role:'system',content:'Search the public web for credible editorial publications relevant to the supplied verified scan facts. Find real editorial contact pages with an explicitly displayed public editorial email address. Never invent addresses, outlet names, relevance or evidence. Return ONLY a JSON object with candidates array; each item has name, category, website, contact_url, email, evidence_ids. At most 29 candidates. Exclude social accounts, press release aggregators, advertising/sales contacts.'},
    {role:'user',content:JSON.stringify({evidence:evidence.map(e=>({id:e.id,fact:e.fact,source_url:e.source_url})),limit})}],
   max_output_tokens:3200
  },{maxRetries:0,timeout:90000});
  let parsed;
  try{parsed=JSON.parse(plainText(answer));}catch{throw Error('DISCOVERY_SEARCH_JSON_INVALID');}
  if(!Array.isArray(parsed?.candidates))throw Error('DISCOVERY_SEARCH_CANDIDATES_REQUIRED');
  const allowed=new Set(evidence.map(e=>e.id)),seen=new Set(),links=[];
  for(const item of parsed.candidates.slice(0,limit)){
   if(!item||typeof item.name!=='string'||typeof item.email!=='string'||typeof item.category!=='string')continue;
   const contactUrl=publicHttps(item.contact_url),website=publicHttps(item.website);
   if(!contactUrl||!website||contactUrl.hostname!==website.hostname||!await publiclyResolved(contactUrl.hostname,resolver))continue;
   const email=item.email.trim().toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||seen.has(email))continue;
   const ids=(Array.isArray(item.evidence_ids)?item.evidence_ids:[]).filter(id=>allowed.has(id));
   if(!ids.length)continue;
   let html;
   try{
    const response=await fetcher(contactUrl.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),headers:{accept:'text/html'}});
    if(!response.ok||!(response.headers.get('content-type')??'').includes('text/html'))continue;
    html=(await response.text()).slice(0,250000);
   }catch{continue;}
   // A model suggestion alone is never proof of a usable editorial address.
   if(!html.toLowerCase().includes(email))continue;
   // A matching email is not itself evidence of editorial suitability.
   const editorialContext=html.toLowerCase();
   const emailPosition=editorialContext.indexOf(email);
   const nearContact=editorialContext.slice(Math.max(0,emailPosition-160),emailPosition+email.length+160);
   if(!/(editorial|newsroom|submissions|contributions|pitch(?:es)?|contact the news team|editor\s*:)/i.test(nearContact))continue;
   const id='web-'+digest(website.hostname+':'+email).slice(0,20);
   const record={id,name:item.name.trim().slice(0,180),category:item.category.trim().slice(0,80),active:true,contact_verified:true,editorial_fit_verified:true,
    website:website.origin,contact:{email,source_url:contactUrl.href,checked_at:new Date().toISOString()},
    verification:{method:'live_editorial_contact_page',source_url:contactUrl.href,evidence_ids:ids}};
   await directory.upsert(record);
   seen.add(email);
   for(const evidence_id of ids){
    const source=evidence.find(e=>e.id===evidence_id);
    links.push({approved:true,outlet_id:id,evidence_id,record_id:source.record_id,source_url:source.source_url});
   }
  }
  return links;
 };
}

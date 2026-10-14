import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpsRequest} from 'node:https';
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
function pinnedContactHtml(url,resolver,timeoutMs=12000,maxBytes=250000){
 return new Promise(async(resolve,reject)=>{
  let addresses;
  try{addresses=await resolver(url.hostname,{all:true,verbatim:true});}
  catch{return reject(Error('CONTACT_DNS_FAILED'));}
  if(!Array.isArray(addresses)||!addresses.length||!addresses.every(a=>publicAddress(a.address)))return reject(Error('CONTACT_ADDRESS_UNSAFE'));
  const address=addresses[0].address;
  const req=httpsRequest(url,{method:'GET',timeout:timeoutMs,maxRedirects:0,lookup:(_host,_opts,cb)=>cb(null,address,isIP(address)),headers:{accept:'text/html'},rejectUnauthorized:true},res=>{
   if(res.statusCode!==200||!String(res.headers['content-type']??'').toLowerCase().includes('text/html')){res.destroy();return reject(Error('CONTACT_RESPONSE_INVALID'));}
   let size=0;const chunks=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy();reject(Error('CONTACT_TOO_LARGE'));}else chunks.push(chunk);});
   res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
   res.on('error',reject);
  });
  req.on('timeout',()=>req.destroy(Error('CONTACT_TIMEOUT')));
  req.on('error',reject);req.end();
 });
}
function publicAddress(address){
 if(isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===192&&p[1]===0)||(p[0]===198&&p[1]>=18&&p[1]<=19));}
 if(isIP(address)===6)return !/^(::|fc|fd|fe8|fe9|fea|feb|2001:db8)/i.test(address);
 return false;
}
function plainText(response){
 return (response.output??[]).flatMap(item=>item.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
}
function safeResponseShape(response){
 const output=Array.isArray(response?.output)?response.output:[];
 return {
  response_type:Array.isArray(response)?'array':response===null?'null':typeof response,
  top_level_keys:response&&typeof response==='object'&&!Array.isArray(response)?Object.keys(response).sort():[],
  output_count:output.length,
  output_types:output.map(item=>typeof item?.type==='string'?item.type:null),
  content_counts:output.map(item=>Array.isArray(item?.content)?item.content.length:0),
  content_types:output.map(item=>(Array.isArray(item?.content)?item.content:[]).map(content=>typeof content?.type==='string'?content.type:null)),
  output_text_lengths:output.map(item=>(Array.isArray(item?.content)?item.content:[]).filter(content=>content?.type==='output_text').map(content=>typeof content?.text==='string'?content.text.length:null))
 };
}
export function createAutonomousOutletDiscovery({openai,directory,fetcher,resolver=lookup,contactReader=pinnedContactHtml,model='gpt-4.1-mini',limit=29}={}){
 if(typeof openai?.responses?.create!=='function'||typeof directory?.upsert!=='function'||typeof contactReader!=='function')throw Error('AUTONOMOUS_DISCOVERY_DEPENDENCIES_REQUIRED');
 return async ({document,outlets=[]})=>{
  const evidence=(document?.evidence??[]).filter(e=>e?.verified===true&&e?.id&&e?.fact&&e?.source_url);
  if(!evidence.length)throw Error('DISCOVERY_VERIFIED_EVIDENCE_REQUIRED');
  const reusable=Array.isArray(outlets)?outlets.filter(o=>o?.active===true&&o?.contact_verified===true&&o?.editorial_fit_verified===true&&o?.contact?.email&&o?.contact?.source_url&&Array.isArray(o?.verification?.evidence_ids)&&o?.verification?.scan_evidence_digest===digest(JSON.stringify(evidence.map(e=>[e.id,e.fact,e.source_url])))):[];
  const reusableIds=new Set(reusable.flatMap(o=>o.verification.evidence_ids));
  const remaining=evidence.filter(e=>!reusableIds.has(e.id));
  const reused=[];
  for(const outlet of reusable){for(const evidence_id of outlet.verification.evidence_ids){const source=evidence.find(e=>e.id===evidence_id);if(source)reused.push({approved:true,outlet_id:outlet.id,evidence_id,record_id:source.record_id,source_url:source.source_url});}}
  if(!remaining.length)return reused;
  const answer=await openai.responses.create({
   model,tools:[{type:'web_search'}],tool_choice:'required',
   input:[{role:'system',content:'Search the public web for credible editorial publications relevant to the supplied verified scan facts. Find real editorial contact pages with an explicitly displayed public editorial email address. Never invent addresses, outlet names, relevance or evidence. Return ONLY a JSON object with candidates array; each item has name, category, website, contact_url, email, evidence_ids. At most 29 candidates. Exclude social accounts, press release aggregators, advertising/sales contacts.'},
    {role:'user',content:JSON.stringify({evidence:remaining.map(e=>({id:e.id,fact:e.fact,source_url:e.source_url})),limit})}],
   max_output_tokens:3200
  },{maxRetries:0,timeout:90000});
  let parsed;
  try{parsed=JSON.parse(plainText(answer));}catch(error){
   console.error('V3_DISCOVERY_SEARCH_PARSE_DIAGNOSTIC '+JSON.stringify({...safeResponseShape(answer),parse_error_name:error?.name??null,parse_error_message:typeof error?.message==='string'?error.message.slice(0,160):null}));
   throw Error('DISCOVERY_SEARCH_JSON_INVALID');
  }
  if(!Array.isArray(parsed?.candidates))throw Error('DISCOVERY_SEARCH_CANDIDATES_REQUIRED');
  const allowed=new Set(remaining.map(e=>e.id)),seen=new Set(),links=[...reused];
  for(const item of parsed.candidates.slice(0,limit)){
   if(!item||typeof item.name!=='string'||typeof item.email!=='string'||typeof item.category!=='string')continue;
   const contactUrl=publicHttps(item.contact_url),website=publicHttps(item.website);
   if(!contactUrl||!website||contactUrl.hostname!==website.hostname||!await publiclyResolved(contactUrl.hostname,resolver))continue;
   const email=item.email.trim().toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||seen.has(email))continue;
   const ids=(Array.isArray(item.evidence_ids)?item.evidence_ids:[]).filter(id=>allowed.has(id));
   if(!ids.length)continue;
   let html;
   try{html=await contactReader(contactUrl,resolver);}catch{continue;}
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
    verification:{method:'live_editorial_contact_page',source_url:contactUrl.href,evidence_ids:ids,scan_evidence_digest:digest(JSON.stringify(evidence.map(e=>[e.id,e.fact,e.source_url])))}};
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

import {isEditorialSourceInstitution} from '../../emradar-v3-authoritative/src/discovery-coverage.js';
import {createEditorialContactResearch,researchPublishedDirectory} from './editorial-contact-research.js';
import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpsRequest} from 'node:https';
const digest=value=>createHash('sha256').update(value).digest('hex');
const host=value=>String(value??'').toLowerCase().replace(/^www\./,'');
function publicHttps(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!['localhost','127.0.0.1','0.0.0.0','::1'].includes(u.hostname)&&u.hostname.includes('.')&&!u.hostname.endsWith('.local')&&!u.hostname.endsWith('.internal')?u:null;}catch{return null;}}
function publicAddress(address){if(isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===192&&p[1]===0)||(p[0]===198&&p[1]>=18&&p[1]<=19));}return isIP(address)===6&&!/^(::|fc|fd|fe8|fe9|fea|feb|2001:db8)/i.test(address);}
async function publiclyResolved(name,resolver){if(isIP(name))return false;try{const addresses=await resolver(name,{all:true,verbatim:true});return addresses.length>0&&addresses.every(({address})=>publicAddress(address));}catch{return false;}}
export const pinnedLookup=address=>(_hostname,options,callback)=>options?.all===true?callback(null,[{address,family:isIP(address)}]):callback(null,address,isIP(address));
export function pinnedHtml(url,resolver,timeoutMs=12000,maxBytes=1000000){return new Promise(async(resolve,reject)=>{let addresses;try{addresses=await resolver(url.hostname,{all:true,verbatim:true});}catch{return reject(Error('CONTACT_DNS_FAILED'));}if(!addresses?.length||!addresses.every(a=>publicAddress(a.address)))return reject(Error('CONTACT_ADDRESS_UNSAFE'));const address=addresses[0].address;const req=httpsRequest(url,{method:'GET',timeout:timeoutMs,maxRedirects:0,lookup:pinnedLookup(address),headers:{accept:'text/html'},rejectUnauthorized:true},res=>{if(res.statusCode!==200||!String(res.headers['content-type']??'').toLowerCase().includes('text/html')){res.destroy();return reject(Error(res.statusCode===403?'CONTACT_HTTP_403':'CONTACT_RESPONSE_INVALID'));}let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy();reject(Error('CONTACT_TOO_LARGE'));}else chunks.push(chunk);});res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));res.on('error',reject);});req.on('timeout',()=>req.destroy(Error('CONTACT_TIMEOUT')));req.on('error',reject);req.end();});}
const plainText=response=>(response.output??[]).flatMap(item=>item.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
function safeResponseShape(response){const output=Array.isArray(response?.output)?response.output:[];return {response_type:Array.isArray(response)?'array':response===null?'null':typeof response,top_level_keys:response&&typeof response==='object'&&!Array.isArray(response)?Object.keys(response).sort():[],output_count:output.length,output_types:output.map(item=>typeof item?.type==='string'?item.type:null),content_counts:output.map(item=>Array.isArray(item?.content)?item.content.length:0),content_types:output.map(item=>(Array.isArray(item?.content)?item.content:[]).map(content=>typeof content?.type==='string'?content.type:null)),output_text_lengths:output.map(item=>(Array.isArray(item?.content)?item.content:[]).filter(content=>content?.type==='output_text').map(content=>typeof content?.text==='string'?content.text.length:null))};}

export function contactPurpose(html,near,url){
 const text=near.replace(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'').replace(/<[^>]*>/g,' ');
 if(/advertis|sales|privacy|technical support|customer service/i.test(text)&&!/editor|newsroom|submission|contribut|pitch/i.test(text))return null;
 if(/submission|contribut|pitch/i.test(text))return 'submissions';
 if(/editor|newsroom/i.test(text))return /editor[- ]in[- ]chief|managing editor|editor\s*:/i.test(text)?'named_editor':'editorial';
 // A general contact on the official contact/about page is a legitimate publication address.
 if(/contact|about/i.test(url.pathname)||/general (?:enquir|inquir)|contact us/i.test(html.replace(/<[^>]*>/g,' ')))return 'general';
 return null;
}

export function deriveDiscoveryContext(document){
 const evidence=(document?.evidence??[]).filter(e=>e?.verified===true&&e?.id&&e?.record_id),byRecord=new Map();
 for(const item of evidence){if(!byRecord.has(item.record_id))byRecord.set(item.record_id,[]);byRecord.get(item.record_id).push(item.id);}
 const formations=(document?.records??[]).map(record=>{const chain=record?.causal_chain??{},industries=Array.isArray(chain.industries)?chain.industries.filter(Boolean):[],evidence_ids=byRecord.get(record?.id)??[];return record?.id&&industries.length&&evidence_ids.length?{id:record.id,status:record.status??null,theme:record.theme??record.title??null,location:record.location??null,world_change:chain.world_change??null,formation:chain.formation??null,industries,pressures:chain.pressures??chain.pressure??null,bottlenecks:chain.bottlenecks??chain.bottleneck_or_scarcity??null,consequences:chain.consequences??null,evidence_ids}:null;}).filter(Boolean);
 const industries=[...new Set(formations.flatMap(item=>item.industries))];
 return {formations,industries,ecosystems:formations.map(item=>({formation_id:item.id,location:item.location,industries:item.industries,pressures:item.pressures,bottlenecks:item.bottlenecks,consequences:item.consequences}))};
}

export function createAutonomousOutletDiscovery({openai,directory,resolver=lookup,contactReader=pinnedHtml,model='gpt-4.1-mini',limit=30,maxRunMs=12*60*1000}={}){
 if(typeof openai?.responses?.create!=='function'||typeof directory?.upsert!=='function'||typeof contactReader!=='function')throw Error('AUTONOMOUS_DISCOVERY_DEPENDENCIES_REQUIRED');
 return async({document,outlets=[],candidateHints=[],formationIds:requestedFormations,maxRunMs:runBudget=maxRunMs})=>{
  const started=Date.now();
  const pages=new Map();const read=url=>{if(!pages.has(url.href))pages.set(url.href,contactReader(url,resolver));return pages.get(url.href);};
  const research=createEditorialContactResearch({read});
  const history=typeof directory.researchHistory==='function'?await directory.researchHistory(digest(JSON.stringify((document?.evidence??[]).filter(e=>e?.verified===true&&e?.id&&e?.fact&&e?.source_url).map(e=>[e.id,e.fact,e.source_url])))):[];
  const evidence=(document?.evidence??[]).filter(e=>e?.verified===true&&e?.id&&e?.fact&&e?.source_url);if(!evidence.length)throw Error('DISCOVERY_VERIFIED_EVIDENCE_REQUIRED');
  const fullContext=deriveDiscoveryContext(document);const context=requestedFormations?{...fullContext,formations:fullContext.formations.filter(f=>requestedFormations.includes(f.id)),ecosystems:fullContext.ecosystems.filter(f=>requestedFormations.includes(f.formation_id))}:fullContext;if(!context.formations.length||!context.industries.length)throw Error('DISCOVERY_MARKET_CONTEXT_REQUIRED');
  const scanDigest=digest(JSON.stringify(evidence.map(e=>[e.id,e.fact,e.source_url]))),reusable=outlets.filter(o=>recipientPolicy.verifiedDestination(o)&&!isEditorialSourceInstitution(o,document)&&o?.verification?.scan_evidence_digest===scanDigest),reusableIds=new Set(reusable.flatMap(o=>o.verification.evidence_ids??[])),remaining=evidence.filter(e=>!reusableIds.has(e.id)),links=[];
  for(const outlet of reusable)for(const evidence_id of outlet.verification.evidence_ids){const source=evidence.find(e=>e.id===evidence_id);if(source)links.push({approved:true,outlet_id:outlet.id,evidence_id,record_id:source.record_id,source_url:source.source_url});}const searchEvidence=evidence.filter(e=>!requestedFormations||requestedFormations.includes(e.record_id));
  const schema={type:'object',additionalProperties:false,properties:{candidates:{type:'array',maxItems:30,items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},category:{type:'string'},publication_type:{type:'string',enum:['trade_publication','news_publication','financial_publication','research_publication','magazine','journal','business_information','newsletter','podcast','social_media','public_forum','industry_association']},website:{type:'string'},publication_proof_url:{type:'string'},contact_url:{type:'string'},email:{type:'string'},directory_source_url:{type:'string'},publisher_source_url:{type:'string'},formation_ids:{type:'array',items:{type:'string'}},industries:{type:'array',items:{type:'string'}},ecosystem_formation_ids:{type:'array',items:{type:'string'}},evidence_ids:{type:'array',items:{type:'string'}},relationship_reason:{type:'string'}},required:['name','category','publication_type','website','publication_proof_url','contact_url','email','directory_source_url','publisher_source_url','formation_ids','industries','ecosystem_formation_ids','evidence_ids','relationship_reason']}}},required:['candidates']};
  const fields=schema.properties.candidates.items.properties;
  for(const field of ['formation_ids','ecosystem_formation_ids'])fields[field]={type:'array',minItems:1,items:{type:'string',enum:context.formations.map(f=>f.id)}};
  fields.industries={type:'array',minItems:1,items:{type:'string',enum:context.industries}};
  fields.evidence_ids={type:'array',minItems:1,items:{type:'string',enum:searchEvidence.map(e=>e.id)}};
  const answer=await openai.responses.create({model,tools:[{type:'web_search',search_context_size:'low'}],max_tool_calls:4,tool_choice:'required',input:[{role:'system',content:'Discover credible independent publications, financial and business-information platforms, newsletters, business and industry podcasts (including Fear & Greed where relevant), professional social-media accounts, public discussion forums and industry associations across ALL supplied formations. Search across the different industries and geographies in the supplied search_brief. Find a genuine public article, episode, discussion, profile or About page proving the destination publishes relevant material: use its HTTPS domain as website and its full URL as publication_proof_url on the same host. International and indirect economic links are valid when explained through transport, fuel, equipment or finance consequences supported by the scan. Exclude operating companies, government agencies, policy institutions and corporate newsrooms. Do not invent contact details. Identify genuine relevant publications; the website research worker will navigate official contact pages. Also search accessible public editorial/press directories, newspaper and magazine associations, and official publisher portfolios. Supply directory_source_url or publisher_source_url where an actual public page names this publication, links its official website and publishes contacts. These fields may be empty. Exclude paid lead lists, guessed addresses and scraped personal-data brokers. Include exact contact addresses and URLs only when actually published. An empty contact field is allowed for the worker to research. Search official contact, contributor, newsroom and editor pages. Accept legitimate general publication contacts and named editors, not advertising-only, sales, privacy or technical support contacts. Never infer email patterns. Aim to identify 10 or more credible publications across the supported research themes, up to the supplied limit. This is a research target, never a quota: return fewer when genuine sources are unavailable. Continue past unsuitable or inaccessible candidates; previous_publication_hints are previously investigated publications, so search for additional independent publications rather than returning the same list. Category targets are guidance, never quotas. The relationship_reason must state what the publication covers and explain its economic connection; do not claim it reported this scan. Use exact enum values for all identifiers and industries. Do not invent addresses. The independent worker must verify a recipient before anything is saved. Return required JSON.'},{role:'user',content:JSON.stringify({previous_publication_hints:[...candidateHints,...history.filter(r=>r.status!=='VERIFIED'&&r.publication!=='EMRADAR_DISCOVERY_COVERAGE_V1').map(r=>({name:r.publication,website:r.website}))].map(({name,website})=>({name,website})),search_brief:context.formations.map(f=>[f.location,f.theme,...f.industries].filter(Boolean).join(' ')).join(' | ')+' official editorial contributor submissions named editor general contact email trade magazine business finance newsletters',formations:context.formations,connected_ecosystems:context.ecosystems,evidence:searchEvidence.map(e=>({id:e.id,record_id:e.record_id,fact:e.fact})),limit})}],text:{format:{type:'json_schema',name:'editorial_publication_candidates',strict:true,schema}},max_output_tokens:10000},{maxRetries:0,timeout:90000});
  console.info('V3_DISCOVERY_USAGE '+JSON.stringify({model,usage:answer.usage,search_calls:(answer.output??[]).filter(item=>item.type==='web_search_call').length}));
  let parsed;try{parsed=JSON.parse(plainText(answer));}catch(error){console.error('V3_DISCOVERY_SEARCH_PARSE_DIAGNOSTIC '+JSON.stringify({...safeResponseShape(answer),parse_error_name:error?.name??null}));throw Error('DISCOVERY_SEARCH_JSON_INVALID');}if(!Array.isArray(parsed?.candidates))throw Error('DISCOVERY_SEARCH_CANDIDATES_REQUIRED');
  const allowed=new Set(searchEvidence.map(e=>e.id)),formationIds=new Set(context.formations.map(x=>x.id)),industryNames=new Set(context.industries),sourceHosts=new Set(evidence.filter(e=>/government|ministry|department|authority|secretariat/i.test(e.source??'')).map(e=>publicHttps(e.source_url)).filter(Boolean).map(u=>host(u.hostname))),seen=new Set(reusable.map(o=>o.contact.email.toLowerCase())),hosts=new Set(),existing=typeof directory.list==='function'?await directory.list():outlets,known=new Map(existing.filter(o=>o?.id).map(o=>[o.id,o]));

  const counts={proposed:parsed.candidates.length,considered:0,missing_fields:0,invalid_url_or_dns:0,source_institution:0,no_verified_evidence_link:0,no_market_relationship:0,publication_proof_failed:0,verified_publications:0,contact_fetch_failed:0,invalid_email_or_duplicate:0,email_not_on_page:0,no_editorial_context:0,verified_contacts:0,reused_contacts:0,unresolved_contacts:0,unresolved:0};
  const sourceUrls=response=>[...(response.output??[]).filter(x=>x.type==='web_search_call').flatMap(x=>x.action?.sources??[]).map(x=>x.url),...(response.output??[]).flatMap(x=>x.content??[]).flatMap(x=>x.annotations??[]).filter(x=>x.type==='url_citation').map(x=>x.url)].filter(Boolean);
  for(const item of parsed.candidates){
   const website=publicHttps(item?.website),key=website?host(website.hostname):null;
   if(key&&hosts.has(key))continue;if(key)hosts.add(key);
   counts.considered++;
   const journal={publication:String(item?.name??'Unnamed candidate').slice(0,180),website:website?.origin??null,scan_digest:scanDigest,industry_relevance:item?.relationship_reason??null,industries:item?.industries??[],evidence_ids:item?.evidence_ids??[],attempted_at:new Date().toISOString(),status:'UNRESOLVED',contact:null,failures:[],pages:[]};
   let publicationPersisted=false;
   try{
    if(Date.now()-started>=runBudget)throw Error('RESEARCH_RUN_BUDGET_EXHAUSTED');
    if(!item?.name?.trim()||!item?.relationship_reason?.trim()){counts.missing_fields++;throw Error('CANDIDATE_FIELDS_MISSING');}
    const proofUrl=publicHttps(item.publication_proof_url);
    if(!website||!proofUrl||host(proofUrl.hostname)!==key||!await publiclyResolved(website.hostname,resolver)){counts.invalid_url_or_dns++;throw Error('PUBLICATION_URL_OR_DNS_INVALID');}
    if(sourceHosts.has(key)||isEditorialSourceInstitution(item,document)){counts.source_institution++;throw Error('SOURCE_INSTITUTION_NOT_PUBLICATION');}
    const ids=(item.evidence_ids??[]).filter(id=>allowed.has(id));
    if(!ids.length){counts.no_verified_evidence_link++;throw Error('NO_VERIFIED_EVIDENCE_LINK');}
    const formation_ids=(item.formation_ids??[]).filter(id=>formationIds.has(id)),ecosystem_formation_ids=(item.ecosystem_formation_ids??[]).filter(id=>formationIds.has(id)),industries=(item.industries??[]).filter(name=>industryNames.has(name));
    if(!formation_ids.length||!ecosystem_formation_ids.length||!industries.length||!ids.every(id=>formation_ids.includes(evidence.find(e=>e.id===id)?.record_id))){counts.no_market_relationship++;throw Error('NO_SUPPORTED_MARKET_RELATIONSHIP');}
    const id='web-'+digest(key).slice(0,20),prior=known.get(id);
    const current=typeof directory.list==='function'?await directory.list():[...known.values()];
    const campaign=current.filter(o=>o.verification?.scan_evidence_digest===scanDigest);
    if(!campaign.some(o=>o.id===id)&&(campaign.length>=30||new Set(campaign.map(o=>o.editorial_group_id??o.id)).size>=15))throw Error('EDITORIAL_CAMPAIGN_LIMIT_REACHED');
    if(prior?.opted_out||prior?.do_not_contact||prior?.contact?.opted_out||prior?.contact?.do_not_contact)throw Error('PUBLICATION_OPTED_OUT');
    if(reusable.some(outlet=>outlet.id===id)){journal.status='VERIFIED';journal.contact=prior.contact;journal.verification=prior.verification;journal.retry_eligible_at=null;counts.reused_contacts++;continue;}
    const past=history.find(record=>record.website&&host(new URL(record.website).hostname)===key);
    const base={id,editorial_fit_verified:true,name:item.name.trim().slice(0,180),category:String(item.category??'').trim().slice(0,80),destination_class:['podcast','social_media','public_forum','business_information','newsletter','industry_association'].includes(item.publication_type)?'INFORMATION_CHANNEL':'EDITORIAL_PUBLICATION',publication_type:item.publication_type,website:website.origin,active:true,relationship:{formation_ids,industries,ecosystem_formation_ids,reason:item.relationship_reason.trim().slice(0,500)}};
    let proofHtml,proofSource=proofUrl.href,result,proofFailure=null;
    const fresh=recipientPolicy.verifiedDestination(prior)&&Date.now()-Date.parse(prior.contact.checked_at)<30*86400000;
    if(fresh){
     result={primary:prior.contact,alternatives:prior.contact.alternatives??[],pages:[],failures:[],source_kind:prior.verification.method};
     proofSource=prior.verification.publication_proof_url;counts.reused_contacts++;
    }else{
     try{
      proofHtml=await read(proofUrl);if(/(?:government (?:agency|department)|regulatory authority|corporate newsroom|investor relations|our (?:products|customers|solutions))/i.test(proofHtml.replace(/<[^>]*>/g,' '))&&!/(?:independent (?:news|journalism|publication)|editor[- ]in[- ]chief|managing editor)/i.test(proofHtml))throw Error('SOURCE_INSTITUTION_NOT_PUBLICATION');if(!/(?:news|article|analysis|journal|magazine|editorial|reporting|stories|podcast|episode|newsletter)/i.test(proofHtml))throw Error('PUBLICATION_MARKERS_MISSING');
      const publication={...base,publication_verified:true,contact_verified:false,delivery_eligible:false,contact_status:'UNRESOLVED',discovery_status:'PUBLICATION_VERIFIED_CONTACT_UNRESOLVED',contact:null,verification:{publication_method:'live_publication_page',publication_status:'VERIFIED',publication_proof_url:proofSource,publication_page_sha256:digest(proofHtml),evidence_ids:ids,scan_evidence_digest:scanDigest}};
      if(typeof directory.upsertPublication==='function')await directory.upsertPublication(publication);
      publicationPersisted=true;counts.verified_publications++;journal.publication_verified=true;journal.publication_verification=publication.verification;
     }catch(error){proofFailure=error.message;journal.failures.push({url:proofUrl.href,reason:error.message});}
     if(past?.status!=='VERIFIED'&&Date.parse(past?.retry_eligible_at)>Date.now()){journal.retry_eligible_at=past.retry_eligible_at;throw Error('RESEARCH_RETRY_DEFERRED');}
     result=await research({website:website.href,publication:base.name,topics:industries,sourceUrls:[item.contact_url,proofUrl.href].filter(Boolean)});
     journal.pages.push(...result.pages);journal.failures.push(...result.failures);journal.contact_observations=(result.contacts??[]).slice(0,50).map(({email,purpose,eligible,rejection_reason,source_url})=>({email,purpose,eligible,rejection_reason,source_url}));
     let alternatives=[item.directory_source_url,item.publisher_source_url].filter(Boolean);
     if(!result.primary||proofFailure){
      try{
       const fallback=await openai.responses.create({model,tools:[{type:'web_search',search_context_size:'low'}],include:['web_search_call.action.sources'],tool_choice:'required',max_tool_calls:2,input:'Research public editorial contacts for '+base.name+' (official website '+website.origin+'). Search Contact Us, Editorial, Newsroom, Contributors, About, Submissions and accessible official publisher pages or public press/editorial/association directory entries. Find indexed source URLs that can be independently retrieved; never use a search snippet as proof of an email. For a directory/publisher page, require this exact publication name, its official website link and a published editor or editorial desk. Do not return email addresses, paid lead lists or inferred patterns. Return JSON {"urls":["https://..."]}, at most 6 different source URLs. Do not retry the blocked URLs: '+JSON.stringify(journal.failures.map(x=>x.url)),max_output_tokens:1600},{maxRetries:0,timeout:60000});
       let urls=[];try{urls=JSON.parse(plainText(fallback)).urls??[];}catch{}
       alternatives.push(...urls,...sourceUrls(fallback));
      }catch(error){journal.failures.push({reason:'FALLBACK_SEARCH_FAILED'});}
      const urls=[...new Set(alternatives)].map(publicHttps).filter(Boolean).filter(url=>!journal.failures.some(f=>f.url===url.href)).slice(0,6);
      const official=urls.filter(url=>host(url.hostname)===key);
      if(official.length){
       const alternate=await createEditorialContactResearch({read,maxPages:4,maxMs:30000})({website:official[0].href,publication:base.name,topics:industries,sourceUrls:official.slice(1).map(url=>url.href)});
       journal.pages.push(...alternate.pages);journal.failures.push(...alternate.failures);
       if(alternate.primary)result=alternate;
      }
      for(const source of urls.filter(url=>host(url.hostname)!==key).slice(0,3)){
       try{const directoryResult=await researchPublishedDirectory({read,url:source.href,website:website.href,publication:base.name,topics:industries});
        journal.pages.push(...directoryResult.pages);if(!result.primary||proofFailure){result=directoryResult;proofFailure=null;proofSource=source.href;proofHtml=await read(source);}if(result.primary)break;
       }catch(error){journal.failures.push({url:source.href,reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'DIRECTORY_READ_FAILED'});}
      }
     }
     if(!result.primary){counts.contact_fetch_failed++;throw Error(result.status??'NO_VERIFIED_CONTACT');}
     if(result.source_kind!=='published_editorial_directory'&&proofFailure){
      let proven=false;
      for(const page of journal.pages.filter(page=>host(new URL(page.url).hostname)===key)){
       const html=await read(new URL(page.url));
       if(/publication|magazine|journal|news|editorial|editor|reporting/i.test(html)){proofHtml=html;proofSource=page.url;proven=true;break;}
      }
      if(!proven){counts.publication_proof_failed++;throw Error('PUBLICATION_IDENTITY_NOT_PROVEN');}
     }
    }
    const contact=result.primary,email=contact.email.toLowerCase();
    if(seen.has(email)){counts.invalid_email_or_duplicate++;throw Error('DUPLICATE_RECIPIENT');}
    const publicationMethod=result.source_kind==='published_editorial_directory'?'published_editorial_directory':'live_publication_page';
    const publicationHash=proofHtml?digest(proofHtml):prior?.verification?.publication_page_sha256;
    const publicationVerified=Boolean(publicationHash);
    const discovered={...base,publication_verified:publicationVerified,editorial_fit_verified:true,contact_verified:true,discovery_status:'VERIFIED',contact:{...contact,alternatives:result.alternatives},verification:{method:result.source_kind==='published_editorial_directory'?'published_editorial_directory':'live_editorial_contact_page',status:'VERIFIED',source_url:contact.source_url,...(publicationVerified?{publication_method:publicationMethod,publication_status:'VERIFIED',publication_page_sha256:publicationHash}:{}),publication_proof_url:proofSource,evidence_ids:ids,scan_evidence_digest:scanDigest}};
    recipientPolicy.assertVerifiedDestination(discovered);
    await directory.upsert(discovered);counts.verified_contacts++;seen.add(email);
    if(!publicationPersisted)counts.verified_publications++;
    journal.status='VERIFIED';journal.contact=discovered.contact;journal.verification=discovered.verification;journal.verified_at=new Date().toISOString();journal.retry_eligible_at=null;
    for(const evidence_id of ids){const source=evidence.find(e=>e.id===evidence_id);links.push({approved:true,outlet_id:id,evidence_id,record_id:source.record_id,source_url:source.source_url});}
   }catch(error){
    counts.unresolved++;journal.reason=/^[A-Z0-9_]+$/.test(error?.message)?error.message:'CANDIDATE_RESEARCH_FAILED';
    if(publicationPersisted){journal.status='PUBLICATION_VERIFIED_CONTACT_UNRESOLVED';counts.unresolved_contacts++;}
    journal.retry_eligible_at??=new Date(Date.now()+(/DNS|TIMEOUT|SEARCH_FAILED/.test(journal.reason)?1800000:21600000)).toISOString();
    console.info('V3_CONTACT_RESEARCH_STOP '+JSON.stringify({publication:journal.publication,website:journal.website,status:journal.reason,failures:journal.failures}));
   }finally{
    if(typeof directory.recordResearch==='function')await directory.recordResearch(journal);
   }
  }
  console.info('V3_DISCOVERY_CANDIDATE_COUNTS '+JSON.stringify(counts));return links;
 };
}

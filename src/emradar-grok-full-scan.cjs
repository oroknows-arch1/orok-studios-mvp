'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {buildDiscoveryCoverage}=require('./emradar-grok-discovery-coverage.cjs');
const {validText}=require('./emradar-x-thread-text.cjs');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function citedUrl(url){try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||!['x.com','twitter.com'].includes(u.hostname))return null;u.hostname='x.com';u.hash='';return u.href}catch{return null}}
function parseResearch(result,discovery){
 const response=result?.report;
 if(response?.status!=='completed'||typeof response.id!=='string'||JSON.stringify(response).length>1000000)throw Error('GROK_RESULT_INCOMPLETE');
 const contents=(response.output??[]).flatMap(item=>item.content??[]);
 const citations=new Set(contents.flatMap(content=>(content.annotations??[]).map(a=>citedUrl(a.url??a.url_citation?.url))).filter(Boolean));
 const text=contents.filter(item=>item.type==='output_text').map(item=>item.text).join('');
 let report;try{report=JSON.parse(text)}catch{throw Error('GROK_REPORT_JSON_REQUIRED')}
 if(report.discovery_id!==discovery.record_id||!Array.isArray(report.opportunities)||report.opportunities.length>5)throw Error('GROK_DISCOVERY_COVERAGE_MISMATCH');
 for(const key of ['keywords','alternative_phrases','topic_clusters'])if(!Array.isArray(report[key])||report[key].length>30||report[key].some(s=>typeof s!=='string'||s.length>300))throw Error('GROK_REPORT_INVALID');
 const allowedEvidence=new Set((discovery.record.evidence??[]).map((_,i)=>discovery.record_id+':'+i));
 const seen=new Set();
 const opportunities=report.opportunities.map(o=>{
  const url=citedUrl(o.url),type=o.type;
  if(!url||!citations.has(url)||seen.has(url)||!['REPLY','QUOTE','FOLLOW','MONITOR','COMMUNITY'].includes(type))throw Error('GROK_OPPORTUNITY_UNCITED_OR_DUPLICATE');
  seen.add(url);
  if(['REPLY','QUOTE'].includes(type)&&!/^https:\/\/x\.com\/[^/]+\/status\/\d+/.test(url))throw Error('GROK_CONVERSATION_REQUIRED');
  if(typeof o.rationale!=='string'||!o.rationale.trim()||!Array.isArray(o.evidence_ids)||o.evidence_ids.some(id=>!allowedEvidence.has(id)))throw Error('GROK_EVIDENCE_REQUIRED');
  const scores=['relevance','credibility','recency','engagement','fit'];
  if(scores.some(k=>!Number.isInteger(o.scores?.[k])||o.scores[k]<0||o.scores[k]>5))throw Error('GROK_RANK_INVALID');
  if(o.draft_text&&(!validText(o.draft_text)||!o.evidence_ids.length))throw Error('GROK_DRAFT_INVALID');
  return {type,url,rationale:o.rationale,evidence_ids:o.evidence_ids,draft_text:o.draft_text??null,scores:Object.fromEntries(scores.map(k=>[k,o.scores[k]])),rank:3*o.scores.relevance+3*o.scores.fit+2*o.scores.credibility+o.scores.recency+o.scores.engagement,status:'DRAFT_ONLY',action_id:hash([discovery.record_sha256,type,url,o.draft_text??null])};
 }).sort((a,b)=>b.rank-a.rank);
 const usage=response.usage;
 if(!Number.isSafeInteger(usage?.cost_in_usd_ticks)||usage.cost_in_usd_ticks<0||!Number.isInteger(usage.total_tokens)||usage.total_tokens<0)throw Error('GROK_COST_RECEIPT_REQUIRED');
 const searches=usage.server_side_tool_usage_details;
 if(!Number.isInteger(searches?.x_search_calls)||searches.x_search_calls<1||!Number.isInteger(searches.x_posts_fetched)||searches.x_posts_fetched<0||!Number.isInteger(searches.x_users_fetched)||searches.x_users_fetched<0||opportunities.length&&searches.x_posts_fetched+searches.x_users_fetched===0)throw Error('GROK_SEARCH_PROVENANCE_REQUIRED');
 return {discovery_id:report.discovery_id,keywords:report.keywords,alternative_phrases:report.alternative_phrases,topic_clusters:report.topic_clusters,opportunities,provenance:{record_sha256:discovery.record_sha256,response_id:response.id,model:result.model,citations:[...citations],usage},outbound_actions:0};
}
function createFullScanResearch({store,pilot,loadPublishedBytes,loadPublicationRows,enabled=false,maxRequestsPerBatch=2,maxRequests=20,maxTokens=25000,maxSpendUsd,requestReserveUsd,providerSpendLimitVerified=false,clock=()=>Date.now()}={}){
 if(!store?.mutate||!pilot?.research||typeof loadPublishedBytes!=='function'||typeof loadPublicationRows!=='function')throw Error('GROK_RESEARCH_DEPENDENCIES_REQUIRED');
 if(!Number.isInteger(maxRequestsPerBatch)||maxRequestsPerBatch<1||maxRequestsPerBatch>3||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>30||!Number.isInteger(maxTokens)||maxTokens<100||maxTokens>100000)throw Error('GROK_RESEARCH_BOUNDS_INVALID');
 return async function run(campaign_id){
  if(!enabled)return {status:'DISABLED'};
  // Hosted X Search has no documented per-request dollar cap. Require an
  // independently configured provider spending limit; local reservations alone
  // cannot promise a hard cap on in-flight hosted-tool charges.
  if(!providerSpendLimitVerified||!Number.isFinite(maxSpendUsd)||maxSpendUsd<=0||maxSpendUsd>10||!Number.isFinite(requestReserveUsd)||requestReserveUsd<=0||requestReserveUsd>maxSpendUsd)throw Error('GROK_PROVIDER_SPEND_LIMIT_REQUIRED');
  const state=(await store.adapter.read(campaign_id))?.value,r=state?.audience_x_review,p=state?.audience_x_publication;
  const rows=await loadPublicationRows(campaign_id);
  if(p?.status!=='COMPLETE'||p.manifest_sha256!==r?.manifest_sha256||rows.length!==r.segments.length||rows.some((row,i)=>row.status!=='ACCEPTED'||row.sequence!==i+1||row.receipt_id!==p.posts[i]?.post_id||row.approved_asset_sha256!==r.segments[i].asset_sha256))throw Error('GROK_CONFIRMED_FULL_THREAD_REQUIRED');
  const bytes=await loadPublishedBytes(r.scan);
  if(createHash('sha256').update(bytes).digest('hex')!==r.source_sha256)throw Error('GROK_SOURCE_MISMATCH');
  const document=JSON.parse(bytes.toString('utf8')),coverage=buildDiscoveryCoverage({document,post_id:rows[0].receipt_id,body:r.segments.filter(s=>s.kind==='SUMMARY').map(s=>s.text).join('\n')});
  if(JSON.stringify(coverage.discovery_ids)!==JSON.stringify(r.all_discovery_ids??r.discovery_ids))throw Error('GROK_FULL_SCAN_MISMATCH');
  await store.mutate(campaign_id,current=>{
   if(!current.audience_x_research)current.audience_x_research={run_id:randomUUID(),source_sha256:r.source_sha256,discovery_ids:coverage.discovery_ids,results:{},requests:0,total_tokens:0,cost_ticks:0,reserved_ticks:0,status:'PENDING'};
   if(current.audience_x_research.source_sha256!==r.source_sha256)throw Error('GROK_RESEARCH_SOURCE_CHANGED');return current;
  });
  const budget=Math.floor(maxSpendUsd*1e10),reserve=Math.floor(requestReserveUsd*1e10);
  for(let processed=0;processed<maxRequestsPerBatch;processed++){
   const current=(await store.adapter.read(campaign_id)).value.audience_x_research;
   const discovery=coverage.discoveries.find(d=>!current.results[d.record_id]||current.results[d.record_id].status==='WAITING_CACHE'||current.results[d.record_id].status==='RATE_LIMITED'&&current.results[d.record_id].retry_at<=clock()&&current.results[d.record_id].attempts<3);
   if(!discovery)break;
   const day=new Date(clock()).toISOString().slice(0,10),cacheKey='audience-cache:x:'+hash([discovery.record_sha256,day,pilot.model??null]);
   const cachedRecord=await store.adapter.read(cacheKey),cached=cachedRecord?.value;
   if(cached?.status==='COMPLETE'){
    await store.mutate(campaign_id,s=>{s.audience_x_research.results[discovery.record_id]={status:'COMPLETE',cache_key:cacheKey,report:cached.report};return s;});continue;
   }
   if(current.requests>=maxRequests||current.total_tokens>=maxTokens||current.cost_ticks+current.reserved_ticks+reserve>budget){await store.mutate(campaign_id,s=>{s.audience_x_research.status='BUDGET_EXHAUSTED';return s;});break;}
   const claim=randomUUID();
   await store.mutate(campaign_id,s=>{
    const job=s.audience_x_research,prior=job.results[discovery.record_id];
    if(prior&&!['RATE_LIMITED','WAITING_CACHE'].includes(prior.status))throw Error('GROK_DISCOVERY_ALREADY_CLAIMED');
    if(job.requests>=maxRequests||job.total_tokens>=maxTokens||job.cost_ticks+job.reserved_ticks+reserve>budget)throw Error('GROK_RUN_BUDGET_EXHAUSTED');
    job.requests++;job.reserved_ticks+=reserve;job.results[discovery.record_id]={status:'RUNNING',claim,attempts:(prior?.attempts??0)+1};return s;
   });
   const claimable=!cached||cached.status==='RATE_LIMITED'&&cached.retry_at<=clock();
   const cacheClaimed=claimable&&await store.adapter.compareAndSwap(cacheKey,cachedRecord?.version??null,{status:'RUNNING',claim,campaign_id,record_id:discovery.record_id,started_at:clock()});
   if(!cacheClaimed){await store.mutate(campaign_id,s=>{const job=s.audience_x_research,prior=job.results[discovery.record_id];job.requests--;job.reserved_ticks-=reserve;job.results[discovery.record_id]={status:'WAITING_CACHE',attempts:prior.attempts-1};return s;});break;}
   const cacheVersion=(cachedRecord?.version??0)+1;
   let billedUsage=null;
   try{
    const input={post_id:rows[0].receipt_id,body:coverage.body,evidence:(discovery.record.evidence??[]).map(e=>JSON.stringify(e)),discovery:{...discovery,scan_source_sha256:r.source_sha256}};
    const response=await pilot.research(input),rawUsage=response?.report?.usage;
    if(Number.isSafeInteger(rawUsage?.cost_in_usd_ticks)&&rawUsage.cost_in_usd_ticks>=0&&Number.isInteger(rawUsage.total_tokens)&&rawUsage.total_tokens>=0)billedUsage=rawUsage;
    const report=parseResearch(response,discovery),usage=report.provenance.usage;
    await store.mutate(campaign_id,s=>{const job=s.audience_x_research;if(job.results[discovery.record_id].claim!==claim)throw Error('GROK_CLAIM_CHANGED');job.reserved_ticks-=reserve;job.cost_ticks+=usage.cost_in_usd_ticks;job.total_tokens+=usage.total_tokens;job.results[discovery.record_id]={status:'COMPLETE',cache_key:cacheKey,report};if(job.cost_ticks>budget||job.total_tokens>maxTokens)job.status='BUDGET_EXHAUSTED';return s;});
    await store.adapter.compareAndSwap(cacheKey,cacheVersion,{status:'COMPLETE',report,created_at:clock()});
   }catch(error){
    const rateLimited=error.message==='GROK_RATE_LIMITED',retry_at=clock()+(error.retry_after_ms??60000);
    await store.mutate(campaign_id,s=>{const job=s.audience_x_research,prior=job.results[discovery.record_id];if(prior.status==='COMPLETE')return s;if(prior.claim!==claim)throw Error('GROK_CLAIM_CHANGED');if(rateLimited||billedUsage)job.reserved_ticks-=reserve;if(billedUsage){job.cost_ticks+=billedUsage.cost_in_usd_ticks;job.total_tokens+=billedUsage.total_tokens;}job.results[discovery.record_id]={...prior,status:rateLimited?'RATE_LIMITED':'HALTED_UNCONFIRMED',reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'GROK_RESEARCH_UNCONFIRMED',...(billedUsage?{usage:billedUsage}:{}),...(rateLimited?{retry_at}:{})};return s;});
    await store.adapter.compareAndSwap(cacheKey,cacheVersion,{status:rateLimited?'RATE_LIMITED':'HALTED_UNCONFIRMED',claim,...(rateLimited?{retry_at}:{})});break;
   }
  }
  const done=await store.mutate(campaign_id,s=>{
   const job=s.audience_x_research;if(job.status!=='BUDGET_EXHAUSTED')job.status=coverage.discovery_ids.every(id=>job.results[id]?.status==='COMPLETE')?'COMPLETE':'PARTIAL';
   const opportunities=new Map();for(const [id,result] of Object.entries(job.results))for(const opportunity of result.report?.opportunities??[]){const key=hash([opportunity.type,opportunity.url,opportunity.draft_text]);if(!opportunities.has(key))opportunities.set(key,{...opportunity,discovery_ids:[]});opportunities.get(key).discovery_ids.push(id);}
   job.opportunities=[...opportunities.values()].sort((a,b)=>b.rank-a.rank);job.public_action_policy='DISABLED';return s;
  });
  const job=done.audience_x_research;
  return {status:job.status,discovery_count:coverage.discovery_count,covered:coverage.discovery_ids.filter(id=>job.results[id]?.status==='COMPLETE').length,requests:job.requests,cost_usd:job.cost_ticks/1e10,outbound_actions:0};
 };
}
module.exports={createFullScanResearch,parseResearch};

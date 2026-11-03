'use strict';
// One complete discovery per original post. Never truncate a caveat or split it.
const {createHash}=require('node:crypto');
const {validText}=require('./emradar-x-thread-text.cjs');
const {WRITING}=require('./emradar-audience-writing.cjs');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const compact=x=>String(x??'').replace(/\s+/g,' ').trim();
const financial=/\b(capital|invest\w*|financ\w*|cost\w*|suppl\w*|demand|pric\w*|ownership|execution|revenue|margin\w*|outflows?|inflows?|fund\w*|market access|capacity|freight|insurance|commercial|profit\w*)\b/i;
const list=x=>Array.isArray(x)?x.filter(s=>typeof s==='string').map(compact):typeof x==='string'?[compact(x)]:[];
function draftConciseThread({document,scanUrl,drafts={}}={}){
 if(document?.publication_state!=='PUBLISHED'||!/^\d{4}-\d{2}-\d{2}$/.test(document.snapshot_date||'')||!Array.isArray(document.records)||!document.records.length)throw Error('THREAD_PUBLISHED_SCAN_REQUIRED');
 if(!/^https:\/\/(?:emradar\.net\/|emerging-markets-radar\.onrender\.com\/data\/checkpoints\/discovery-\d{4}-\d{2}-\d{2}\.json$)/.test(scanUrl??''))throw Error('THREAD_SCAN_URL_REQUIRED');
 const ids=new Set(),excluded=[],ranked=[];
 for(const [index,r] of document.records.entries()){
  if(typeof r?.id!=='string'||!r.id||ids.has(r.id))throw Error('THREAD_RECORD_ID_INVALID');ids.add(r.id);
  const sources=(r.evidence??[]).filter(e=>typeof e?.url==='string'&&/^https:\/\//.test(e.url));
  const consequences=list(r.causal_chain?.consequences).concat(list(r.consequences));
  const finding=consequences.find(s=>financial.test(s));
  const caveats=list(r.contradictions).concat(list(r.chain_evolution?.unresolved_evidence),list(r.missing_evidence));
  const state=compact(r.state||r.status||r.formation_state||'UNKNOWN');
  const evidence_ids=sources.map(e=>r.id+':'+r.evidence.indexOf(e));
  if(!finding||!sources.length){excluded.push({record_id:r.id,reason:!sources.length?'NO_LINKED_EVIDENCE':'NO_SUPPORTED_FINANCIAL_CONSEQUENCE'});continue;}
  const supplied=drafts[r.id],prose=supplied?.text??finding,caveat=caveats[0];
  if(typeof prose!=='string'||!prose.includes(finding)||(caveat&&!prose.includes(caveat)&&supplied))throw Error('AUDIENCE_FINANCIAL_FINDING_OR_CAVEAT_MISSING');
  const text=[prose,...(!supplied&&caveat?[caveat]:[]),state+' · '+sources[0].url].join('\n');
  if(!validText(text)){excluded.push({record_id:r.id,reason:'OWNER_CONCISE_REVISION_REQUIRED'});continue;}
  const strength=({CONFIRMED:3,FORMING:2,INVESTIGATE:1})[state]??0;
  // Observable evidence and commercial relevance, never invented audience metrics.
  const rank=[strength,Math.min(sources.length,5),/\d/.test(finding)?1:0,list(r.causal_chain?.connected_companies_and_tickers).length?1:0,list(r.causal_chain?.industries).length?1:0];
  ranked.push({r,index,text,rank,evidence_ids,finding,caveat,state,sources});
 }
 ranked.sort((a,b)=>{for(let i=0;i<a.rank.length;i++)if(a.rank[i]!==b.rank[i])return b.rank[i]-a.rank[i];return a.index-b.index;});
 const angles=new Set();
 for(let i=0;i<ranked.length;){const key=ranked[i].finding.toLowerCase().replace(/\W+/g,' ');if(angles.has(key)){excluded.push({record_id:ranked[i].r.id,reason:'DUPLICATE_FINANCIAL_ANGLE'});ranked.splice(i,1);}else{angles.add(key);i++;}}
 for(const item of ranked.slice(8))excluded.push({record_id:item.r.id,reason:'DAILY_PRIORITY_LIMIT',rank:item.rank});
 const selected=ranked.slice(0,8).sort((a,b)=>a.index-b.index),seenText=new Set();
 const segments=selected.map((item,i)=>{
  if(seenText.has(item.text))throw Error('AUDIENCE_DUPLICATE_POST');seenText.add(item.text);
  return {kind:'DISCOVERY',record_id:item.r.id,sequence:i+1,parent_sequence:null,discovery_part:1,discovery_parts:1,text:item.text,source_links:item.sources.map(e=>e.url),evidence_ids:item.evidence_ids,provenance:{record_sha256:hash(item.r),scan_url:scanUrl,financial_finding:item.finding,material_caveat:item.caveat??null,formation_state:item.state},approval_status:'PENDING'};
 });
 return {mode:'STANDALONE',snapshot_date:document.snapshot_date,record_count:document.records.length,record_ids:selected.map(x=>x.r.id),all_record_ids:[...ids],excluded,segments,publication_status:'DRAFT_ONLY',writing_instructions:WRITING};
}
module.exports={draftConciseThread};

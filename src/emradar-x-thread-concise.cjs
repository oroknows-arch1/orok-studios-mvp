'use strict';
const {planDailyThread}=require('./emradar-x-thread-plan.cjs');
const {parseTweet}=require('twitter-text');
const compact=x=>String(x??'').replace(/\s+/g,' ').trim();
function draftConciseThread({document,scanUrl}={}){
 if(typeof scanUrl!=='string'||!/^https:\/\/emradar\.net\//.test(scanUrl))throw Error('THREAD_SCAN_URL_REQUIRED');
 if(!Array.isArray(document?.records)||!document.records.length)throw Error('THREAD_NO_DISCOVERIES');
 const summary='EMRADAR | '+document.snapshot_date+'\n'+document.records.length+' published discoveries. Evidence states and full analysis: '+scanUrl;
 return planDailyThread({document,scanUrl,summary,renderRecord:(r,{index,total})=>{
  const title=compact(r.title||r.name||r.theme||r.formation?.name||r.id);
  const status=compact(r.state||r.status||r.formation_state||'UNKNOWN');
  const description=compact(r.summary||r.description||r.why_surfaced||r.world_change?.summary||'');
  const source=Array.isArray(r.evidence)?r.evidence.find(e=>typeof e?.url==='string'&&/^https:\/\//.test(e.url))?.url:null;
  const lines=[index+'/'+total+' | '+title,'Evidence state: '+status];
  // Preserve one source URL and full-scan URL, trimming only optional prose.
  const footer=(source?'Source: '+source+'\n':'')+'Full evidence: '+scanUrl;
  const prefix=lines.join('\n')+'\n';
  let detail=description;
  let candidate=prefix+(detail?detail+'\n':'')+footer;
  while(detail&&(!parseTweet(candidate).valid||parseTweet(candidate).weightedLength>280)){
   detail=detail.slice(0,-1);
   candidate=prefix+(detail?detail.trimEnd()+'…\n':'')+footer;
  }
  if(!parseTweet(candidate).valid||parseTweet(candidate).weightedLength>280)throw Error('CONCISE_POST_LINKS_EXCEED_LIMIT');
  return candidate;
 }});
}
module.exports={draftConciseThread};

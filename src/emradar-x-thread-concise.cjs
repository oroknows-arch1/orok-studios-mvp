'use strict';
const {planDailyThread}=require('./emradar-x-thread-plan.cjs');
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
  if(description)lines.push(description.length>350?description.slice(0,349).trimEnd()+'…':description);
  if(source)lines.push('Source: '+source);
  lines.push('Evidence and full causal chain: '+scanUrl);
  return lines.join('\n');
 }});
}
module.exports={draftConciseThread};

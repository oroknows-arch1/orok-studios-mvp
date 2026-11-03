'use strict';
const {planDailyThread}=require('./emradar-x-thread-plan.cjs');
const compact=x=>String(x??'').replace(/\s+/g,' ').trim();
const escapeHtml=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function draftFullScanThread({document,scanUrl}={}){
 const archive='https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-'+document?.snapshot_date+'.json';
 if(typeof scanUrl!=='string'||(!/^https:\/\/emradar\.net\//.test(scanUrl)&&scanUrl!==archive))throw Error('THREAD_SCAN_URL_REQUIRED');
 const records=document?.records;
 if(!Array.isArray(records)||!records.length)throw Error('THREAD_NO_DISCOVERIES');
 const summary=`EMRADAR | ${document.snapshot_date}\nToday's published scan contains ${records.length} discoveries. Each finding below retains its evidence and uncertainty.\nFull scan: ${scanUrl}`;
 return planDailyThread({document,scanUrl,summary,renderRecord:(r,{index,total})=>{
  // Do not infer missing formation names or statuses from other fields.
  const title=compact(r.title||r.name||r.theme||r.formation?.name||r.id);
  const status=compact(r.state||r.status||r.formation_state||'UNKNOWN');
  const description=compact(r.summary||r.description||r.why_surfaced||r.world_change?.summary||'');
  const evidence=Array.isArray(r.evidence)?r.evidence:[];
  const sources=evidence.filter(e=>e&&typeof e.url==='string'&&/^https:\/\//.test(e.url)).map(e=>e.url);
  const lines=[`${index}/${total} | ${title}`,`Evidence state: ${status}`];
  if(description)lines.push(description);
  for(const key of ['world_change','pressure','bottleneck_or_scarcity','formation','industries','connected_companies_and_tickers','consequences']){
   const value=r.causal_chain?.[key];
   if(value?.length)lines.push(key.replaceAll('_',' ')+': '+(Array.isArray(value)?value.map(compact).join('; '):compact(value)));
  }
  for(const [label,value] of [['Contradictions',r.contradictions],['Missing evidence',r.missing_evidence],['Unresolved',r.chain_evolution?.unresolved_evidence],['Break conditions',r.chain_evolution?.break_conditions],['Next questions',r.what_to_check_next]]){
   if(value?.length)lines.push(label+': '+(Array.isArray(value)?value.map(compact).join('; '):compact(value)));
  }
  for(const e of evidence)if(e.fact)lines.push('Evidence'+(e.classification?' ('+compact(e.classification)+')':'')+': '+compact(e.fact)+(e.date?' ['+compact(e.date)+']':''));
  if(sources.length)lines.push('Sources: '+sources.join(' '));
  else lines.push('Source details: see the verified scan');
  lines.push('Full record: '+scanUrl);
  return lines.join('\n');
 }});
}
function previewThreadHtml(plan){
 if(!plan||!Array.isArray(plan.segments))throw Error('THREAD_PREVIEW_INVALID');
 const cards=plan.segments.map(s=>`<article><h2>${escapeHtml(s.sequence)}. ${escapeHtml(s.kind)}</h2><p><strong>Approval: ${escapeHtml(s.approval_status)}</strong></p><pre>${escapeHtml(s.text)}</pre></article>`).join('');
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>EMRADAR X thread draft</title><style>body{font:16px system-ui;max-width:760px;margin:2rem auto;padding:0 1rem}article{border:1px solid #bbb;border-radius:12px;padding:1rem;margin:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><h1>Full-scan X thread — preview only</h1><p>Not approved or published. Images and final platform length validation are not included.</p>'+cards+'</html>';
}
module.exports={draftFullScanThread,previewThreadHtml};

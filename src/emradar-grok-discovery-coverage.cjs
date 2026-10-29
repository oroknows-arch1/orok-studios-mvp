'use strict';
// Exhaustive published-scan input adapter: no top-N truncation and no invented findings.
const {createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function buildDiscoveryCoverage({document,post_id,body}={}){
 if(!document||document.publication_state!=='PUBLISHED'||!/^\d{4}-\d{2}-\d{2}$/.test(document.snapshot_date||''))throw Error('AUDIENCE_PUBLISHED_SCAN_REQUIRED');
 if(!Array.isArray(document.records))throw Error('AUDIENCE_RECORDS_REQUIRED');
 if(!/^\d+$/.test(String(post_id||''))||typeof body!=='string'||!body.trim())throw Error('AUDIENCE_POST_REQUIRED');
 const seen=new Set();
 const discoveries=document.records.map((record,index)=>{
  if(!record||typeof record.id!=='string'||!record.id.trim()||seen.has(record.id))throw Error('AUDIENCE_RECORD_ID_INVALID');
  seen.add(record.id);
  return {record_id:record.id,index,record,record_sha256:sha(record)};
 });
 return {snapshot_date:document.snapshot_date,post_id:String(post_id),body,
  discovery_count:discoveries.length,discovery_ids:discoveries.map(x=>x.record_id),
  discoveries,source_sha256:sha(document)};
}
function verifyCoverage(source,results){
 if(!results||!Array.isArray(results.covered_record_ids))throw Error('AUDIENCE_COVERAGE_MISSING');
 const expected=new Set(source.discovery_ids),found=new Set(results.covered_record_ids);
 const missing=[...expected].filter(id=>!found.has(id)),unknown=[...found].filter(id=>!expected.has(id));
 return {complete:missing.length===0&&unknown.length===0,missing,unknown,
  expected_count:expected.size,covered_count:found.size};
}
module.exports={buildDiscoveryCoverage,verifyCoverage};

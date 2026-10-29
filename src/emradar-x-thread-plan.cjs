'use strict';
// Pure draft planner. No X API calls or production wiring.
// Each published record receives a dedicated thread segment.
function planDailyThread({document,summary,renderRecord,scanUrl}={}) {
 if(document?.publication_state!=='PUBLISHED'||!Array.isArray(document.records)||!/^\d{4}-\d{2}-\d{2}$/.test(document.snapshot_date||''))throw Error('THREAD_PUBLISHED_SCAN_REQUIRED');
 if(typeof summary!=='string'||!summary.trim()||typeof renderRecord!=='function')throw Error('THREAD_INPUT_INVALID');
 const ids=new Set();
 const segments=document.records.map((record,i)=>{
  if(typeof record?.id!=='string'||!record.id||ids.has(record.id))throw Error('THREAD_RECORD_ID_INVALID');
  ids.add(record.id);
  const text=renderRecord(record,{index:i+1,total:document.records.length});
  if(typeof text!=='string'||!text.trim())throw Error('THREAD_SEGMENT_MISSING_'+record.id);
  return {kind:'DISCOVERY',record_id:record.id,sequence:i+2,text,approval_status:'PENDING'};
 });
 const lead={kind:'SUMMARY',sequence:1,text:summary,approval_status:'PENDING'};
 return {snapshot_date:document.snapshot_date,scan_url:scanUrl||null,
   record_count:document.records.length,segments:[lead,...segments],
   record_ids:[...ids],publication_status:'DRAFT_ONLY'};
}
function validateApproval(plan,approvedSegments){
 if(!plan||!Array.isArray(plan.segments)||!Array.isArray(approvedSegments))throw Error('THREAD_APPROVAL_INVALID');
 if(plan.segments.length!==approvedSegments.length)throw Error('THREAD_APPROVAL_INCOMPLETE');
 for(let i=0;i<plan.segments.length;i++){
  const a=plan.segments[i],b=approvedSegments[i];
  if(a.sequence!==b.sequence||a.text!==b.text||a.record_id!==b.record_id||b.approval_status!=='APPROVED')throw Error('THREAD_APPROVAL_MISMATCH');
 }
 return true;
}
module.exports={planDailyThread,validateApproval};

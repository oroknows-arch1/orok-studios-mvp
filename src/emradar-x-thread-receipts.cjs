'use strict';
// Pure state transitions for sequential X thread publication.
// Persistence and X transport are deliberately injected by a future adapter.
const crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function initializeThread({campaign_id,approved_segments}={}){
 if(!campaign_id||!Array.isArray(approved_segments)||approved_segments.length<2)throw Error('THREAD_INPUT_INVALID');
 const seen=new Set();
 const segments=approved_segments.map((s,i)=>{
  if(s?.sequence!==i+1||s.approval_status!=='APPROVED'||typeof s.text!=='string'||!s.text.trim())throw Error('THREAD_APPROVAL_INVALID');
  if(i>0&&(!s.record_id||seen.has(s.record_id)))throw Error('THREAD_RECORD_INVALID');
  if(i>0)seen.add(s.record_id);
  return {sequence:s.sequence,record_id:s.record_id||null,text_sha256:digest(s.text),status:'PENDING',receipt_id:null,in_reply_to:null};
 });
 return {campaign_id,status:'READY',segments,approved_sha256:digest(approved_segments)};
}
function reserveNext(state){
 if(!['READY','PARTIAL'].includes(state.status))throw Error('THREAD_NOT_READY');
 const index=state.segments.findIndex(s=>s.status==='PENDING');
 if(index<0)throw Error('THREAD_NO_PENDING');
 if(state.segments.some(s=>s.status==='RESERVED'||s.status==='AMBIGUOUS'))throw Error('THREAD_UNRESOLVED');
 if(index>0&&state.segments[index-1].status!=='ACCEPTED')throw Error('THREAD_PARENT_NOT_ACCEPTED');
 const segments=state.segments.map((s,i)=>i===index?{...s,status:'RESERVED',in_reply_to:index?state.segments[index-1].receipt_id:null}:s);
 return {...state,status:'IN_PROGRESS',segments};
}
function recordResult(state,{sequence,receipt_id,ambiguous=false}={}){
 const i=sequence-1,s=state.segments[i];
 if(!s||s.status!=='RESERVED')throw Error('THREAD_RESERVATION_REQUIRED');
 if(!ambiguous&&!/^\d+$/.test(String(receipt_id||'')))throw Error('THREAD_RECEIPT_REQUIRED');
 const segments=state.segments.map((v,j)=>j===i?{...v,status:ambiguous?'AMBIGUOUS':'ACCEPTED',receipt_id:ambiguous?null:String(receipt_id)}:v);
 const status=ambiguous?'HALTED_AMBIGUOUS':segments.every(x=>x.status==='ACCEPTED')?'COMPLETE':'PARTIAL';
 return {...state,status,segments};
}
module.exports={initializeThread,reserveNext,recordResult};

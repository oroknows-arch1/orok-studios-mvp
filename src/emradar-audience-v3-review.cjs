'use strict';
// Uses V3's existing campaign CAS and authenticated owner session. No new inbox,
// approval authority, provider calls or publication side effects.
const {createHash,randomUUID}=require('node:crypto');
const {assetHash}=require('./emradar-audience-asset-hash.cjs');
const {draftFullScanThread}=require('./emradar-x-thread-drafts.cjs');
const {graphic}=require('./emradar-v3-x.cjs');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const bytesHash=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Error('AUDIENCE_'+code)};
const same=(a,b)=>hash(a)===hash(b);
function identity(state){
 const scan=state?.scan;
 if(!scan||!/^\d{4}-\d{2}-\d{2}$/.test(scan.snapshot_date||'')||!/^[a-f0-9]{64}$/.test(scan.artifact_sha256||'')||scan.source_key!==scan.snapshot_date+':'+scan.artifact_sha256)fail('PUBLISHED_SCAN_IDENTITY_REQUIRED');
 return {snapshot_date:scan.snapshot_date,source_key:scan.source_key,artifact_sha256:scan.artifact_sha256};
}
function manifest(review){return hash({campaign_id:review.campaign_id,review_id:review.review_id,scan:review.scan,source_sha256:review.source_sha256,discovery_ids:review.discovery_ids,segments:review.segments});}
function validate(review,state){
 const problems=[];
 if(!review||!same(review.scan,identity(state))||review.campaign_id!==state.id)fail('STALE_SCAN');
 if(!Array.isArray(review.segments)||review.segments.length!==review.discovery_ids.length+1)fail('COVERAGE_INCOMPLETE');
 if(review.manifest_sha256!==manifest(review))fail('MANIFEST_MISMATCH');
 for(const [i,s] of review.segments.entries()){
  if(s.sequence!==i+1||s.parent_sequence!==(i?i:null)||s.kind!==(i?'DISCOVERY':'SUMMARY')||s.record_id!==(i?review.discovery_ids[i-1]:null)||s.asset_sha256!==assetHash(s))fail('SEGMENT_MISMATCH');
  if(!Array.isArray(s.source_links)||s.source_links.some(url=>{try{const u=new URL(url);return u.protocol!=='https:'||u.username||u.password}catch{return true}}))fail('SOURCE_LINK_INVALID');
  if(!i&&review.graphic_required&&!s.media)problems.push('MAIN_GRAPHIC_MISSING');
  if(i&&!s.source_links.length)problems.push('SOURCE_LINKS_MISSING:'+s.record_id);
  if(s.media){
   try{const {bytes,mime}=graphic({kind:'X',destination_id:'x',body:s.text,visual_base64:s.media.base64,visual_sha256:s.media.sha256,visual_mime:s.media.mime});if(mime!==s.media.mime||bytesHash(bytes)!==s.media.sha256)fail('GRAPHIC_MISMATCH');}catch{problems.push('GRAPHIC_BYTES_INVALID:'+s.sequence)}
  }
 }
 return problems;
}
// Manifest includes segment hashes, but excludes its own digest.
function seal(review){review.segments=review.segments.map(s=>({...s,asset_sha256:assetHash(s)}));review.manifest_sha256=manifest(review);return review;}
function createV3AudienceReview({store,loadPublishedBytes,clock=()=>Date.now()}={}){
 if(!store?.mutate||!store.adapter?.read||typeof loadPublishedBytes!=='function')fail('V3_REVIEW_DEPENDENCIES_REQUIRED');
 async function prepare(campaignId){
  const state=(await store.adapter.read(campaignId))?.value;
  if(state?.phase!=='PUBLICATION_REVIEW')fail('REVIEW_NOT_OPEN');
  const scan=identity(state),prior=state.audience_x_review;
  if(prior){validate(prior,state);return prior;}
  if(state.deliveries?.x||state.decisions?.x)fail('EXISTING_X_DECISION_PRESERVED');
  const bytes=await loadPublishedBytes(scan);
  if(!Buffer.isBuffer(bytes)||bytesHash(bytes)!==scan.artifact_sha256)fail('PUBLISHED_BYTES_MISMATCH');
  const document=JSON.parse(bytes.toString('utf8'));
  if(document.snapshot_date!==scan.snapshot_date)fail('SCAN_DATE_MISMATCH');
  const thread=draftFullScanThread({document,scanUrl:'https://emradar.net/?date='+scan.snapshot_date});
  const main=state.assets?.x?.asset;
  const segments=thread.segments.map((s,i)=>({...s,record_id:s.record_id??null,parent_sequence:i?i:null,source_links:i?(document.records[i-1].evidence??[]).map(e=>e.url).filter(u=>typeof u==='string'):[],media:null}));
  // Preserve the saved evidence-bound graphic only with its exact saved text.
  if(main?.body){segments[0].text=main.body+'\n\nAcross the published scan:\n'+document.records.map(r=>r.theme||r.title||r.id).join(' · ')+'\n\n'+segments[0].text;segments[0].source_links=[...new Set(document.records.flatMap(r=>(r.evidence??[]).map(e=>e.url)).filter(u=>typeof u==='string'&&main.body.includes(u)))];}
  if(main?.visual_base64){graphic(main);segments[0].media={base64:main.visual_base64,mime:main.visual_mime,sha256:main.visual_sha256};}
  const review=seal({campaign_id:campaignId,review_id:randomUUID(),scan,source_sha256:scan.artifact_sha256,discovery_ids:thread.record_ids,graphic_required:true,segments});
  await store.mutate(campaignId,current=>{
   if(!same(identity(current),scan)||current.deliveries?.x||current.decisions?.x)fail('PREPARATION_STALE');
   if(!current.audience_x_review){current.audience_x_review=review;current.events??=[];current.events.push({type:'X_THREAD_PREPARED',review_id:review.review_id,manifest_sha256:review.manifest_sha256});}
   return current;
  });
  return (await store.adapter.read(campaignId)).value.audience_x_review;
 }
 async function view(campaignId){
  try{
   const review=await prepare(campaignId),state=(await store.adapter.read(campaignId)).value,problems=validate(review,state);
   return {...review,problems,ready:!problems.length,approval:state.audience_x_approval??null};
  }catch(error){return {ready:false,problems:[/^AUDIENCE_[A-Z0-9_]+$/.test(error.message)?error.message:'AUDIENCE_PREVIEW_UNAVAILABLE'],segments:[]};}
 }
 async function present(campaignId,sessionId,input){
  return store.mutate(campaignId,state=>{
   const r=state?.audience_x_review;
   if(validate(r,state).length||input?.manifest_sha256!==r.manifest_sha256||!same(input.segment_hashes,r.segments.map(s=>s.asset_sha256)))fail('PRESENTATION_INCOMPLETE');
   state.audience_x_presentations??={};state.audience_x_presentations[sessionId]={manifest_sha256:r.manifest_sha256,presented_at:clock()};return state;
  });
 }
 async function decide(campaignId,sessionId,decision,fingerprint){
  if(!['APPROVE','REJECT','EXCLUDE'].includes(decision))fail('DECISION_INVALID');
  const access=(await store.adapter.read('review:'+campaignId))?.value;
  if(access?.status!=='CONSUMED'||access.owner_session?.id!==sessionId||access.owner_session.revoked_at!==null||access.owner_session.expires_at<=clock())fail('OWNER_SESSION_REQUIRED');
  const decided=await store.mutate(campaignId,state=>{
   const r=state?.audience_x_review;
   if(state.phase!=='PUBLICATION_REVIEW'||state.deliveries?.x||state.audience_x_publication_started)fail('DECISION_AFTER_DISTRIBUTION');
   const problems=validate(r,state);
   if(fingerprint!==r.manifest_sha256)fail('DECISION_STALE');
   if(decision==='APPROVE'&&(problems.length||state.audience_x_presentations?.[sessionId]?.manifest_sha256!==fingerprint))fail('PRESENTATION_REQUIRED');
   const event={type:'OWNER_X_THREAD_DECISION',id:randomUUID(),decision,review_id:r.review_id,manifest_sha256:fingerprint,session_id:sessionId,review_access_hash:access.token_hash,at:clock()};
   state.audience_x_approval=event;state.events.push(event);return state;
  });
  if(decision==='APPROVE'){
   let verified=false;try{verified=await verify({campaign_id:campaignId})}catch{}
   await store.mutate(campaignId,state=>{
    if(state.audience_x_approval?.id!==decided.audience_x_approval.id)fail('DECISION_STALE');
    state.audience_x_checks={approval_id:decided.audience_x_approval.id,manifest_sha256:fingerprint,completeness:verified?'PASS':'FAIL',exact_assets:verified?'PASS':'FAIL',authoritative_approval:verified?'PASS':'FAIL',checked_at:clock()};return state;
   });
  }
  return (await store.adapter.read(campaignId)).value;
 }
 async function revise(campaignId,fingerprint,changes){
  if(!changes||Object.keys(changes).some(k=>!['sequence','text'].includes(k))||!Number.isInteger(changes.sequence)||typeof changes.text!=='string'||!changes.text.trim()||changes.text.length>25000)fail('REVISION_INVALID');
  return store.mutate(campaignId,state=>{
   const r=state?.audience_x_review;
   if(state.phase!=='PUBLICATION_REVIEW'||state.deliveries?.x||state.audience_x_publication_started)fail('REVISION_AFTER_DISTRIBUTION');
   validate(r,state);
   if(r.manifest_sha256!==fingerprint)fail('REVISION_STALE');
   const segment=r.segments[changes.sequence-1];if(!segment)fail('REVISION_INVALID');
   state.audience_x_history??=[];state.audience_x_history.push(structuredClone(r));
   segment.text=changes.text;r.review_id=randomUUID();seal(r);delete state.audience_x_approval;state.audience_x_presentations={};
   state.events.push({type:'X_THREAD_REVISED',review_id:r.review_id,manifest_sha256:r.manifest_sha256});return state;
  });
 }
 async function verify({campaign_id,approved_thread}={}){
  const state=(await store.adapter.read(campaign_id))?.value,r=state?.audience_x_review,a=state?.audience_x_approval;
  if(!r||!a||a.decision!=='APPROVE'||a.manifest_sha256!==r.manifest_sha256||a.review_id!==r.review_id)return false;
  if(!state.events?.some(e=>e.type==='OWNER_X_THREAD_DECISION'&&e.id===a.id&&same(e,a)))return false;
  const access=(await store.adapter.read('review:'+campaign_id))?.value;
  const records=[access,...(access?.previous_reviews??[])];
  if(!records.some(item=>item?.token_hash===a.review_access_hash&&item.status==='CONSUMED'&&item.owner_session?.id===a.session_id))return false;
  try{
   if(validate(r,state).length)return false;
   for(const segment of r.segments)if(segment.media)await require('sharp')(Buffer.from(segment.media.base64,'base64')).stats();
  }catch{return false;}
  if(approved_thread&&!same(approved_thread,r))return false;
  const bytes=await loadPublishedBytes(r.scan);
  if(!Buffer.isBuffer(bytes)||bytesHash(bytes)!==r.source_sha256)return false;
  const document=JSON.parse(bytes.toString('utf8'));
  return document.publication_state==='PUBLISHED'&&same(document.records.map(record=>record.id),r.discovery_ids);
 }
 return {view,present,decide,revise,verify,prepare};
}
module.exports={createV3AudienceReview,hash,manifest,validate};

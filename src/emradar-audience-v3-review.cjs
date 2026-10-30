'use strict';
// Uses V3's existing campaign CAS and authenticated owner session. No new inbox,
// approval authority, provider calls or publication side effects.
const {createHash,randomUUID}=require('node:crypto');
const {assetHash}=require('./emradar-audience-asset-hash.cjs');
const {draftFullScanThread}=require('./emradar-x-thread-drafts.cjs');
const {draftConciseThread}=require('./emradar-x-thread-concise.cjs');
const {graphic}=require('./emradar-v3-x.cjs');
const {expandSegments,validText}=require('./emradar-x-thread-text.cjs');
const {extractUrls}=require('twitter-text');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const bytesHash=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Error('AUDIENCE_'+code)};
const same=(a,b)=>hash(a)===hash(b);
function savedGraphics(state){
 const choices=new Map();for(const entry of [state.assets?.x,...(state.editorial_versions?.x??[])]){
  const asset=entry?.asset;if(asset?.campaign_id!==state.id)continue;
  try{const {bytes,mime}=graphic(asset);choices.set(asset.visual_sha256,{base64:bytes.toString('base64'),mime,sha256:asset.visual_sha256,provenance:{campaign_id:state.id,v3_asset_sha256:hash(asset)}});}catch{}
 }
 return [...choices.values()];
}
async function verifyGraphicBytes(review){
 for(const segment of review?.segments??[])if(segment.media){try{const {bytes}=graphic({kind:'X',destination_id:'x',body:segment.text,visual_base64:segment.media.base64,visual_mime:segment.media.mime,visual_sha256:segment.media.sha256});await require('sharp')(bytes).stats();}catch{fail('GRAPHIC_DECODE_FAILED');}}
}
function identity(state){
 const scan=state?.scan;
 if(!scan||!/^\d{4}-\d{2}-\d{2}$/.test(scan.snapshot_date||'')||!/^[a-f0-9]{64}$/.test(scan.artifact_sha256||'')||scan.source_key!==scan.snapshot_date+':'+scan.artifact_sha256)fail('PUBLISHED_SCAN_IDENTITY_REQUIRED');
 return {snapshot_date:scan.snapshot_date,source_key:scan.source_key,artifact_sha256:scan.artifact_sha256};
}
function manifest(review){return hash({campaign_id:review.campaign_id,review_id:review.review_id,scan:review.scan,source_sha256:review.source_sha256,all_discovery_ids:review.all_discovery_ids,excluded_discovery_ids:review.excluded_discovery_ids,discovery_ids:review.discovery_ids,source_links_by_record:review.source_links_by_record,graphic_required:review.graphic_required,segments:review.segments});}
function validate(review,state){
 const problems=[];
 if(!review||!same(review.scan,identity(state))||review.campaign_id!==state.id)fail('STALE_SCAN');
 if(!Array.isArray(review.segments)||!review.segments.length||new Set(review.discovery_ids).size!==review.discovery_ids.length)fail('COVERAGE_INCOMPLETE');
 if(!Array.isArray(review.all_discovery_ids)||!Array.isArray(review.excluded_discovery_ids)||new Set(review.all_discovery_ids).size!==review.all_discovery_ids.length||new Set(review.excluded_discovery_ids).size!==review.excluded_discovery_ids.length||review.excluded_discovery_ids.some(id=>!review.all_discovery_ids.includes(id))||!same(review.all_discovery_ids.filter(id=>!review.excluded_discovery_ids.includes(id)),review.discovery_ids))fail('EXCLUSIONS_MISMATCH');
 if(review.manifest_sha256!==manifest(review))fail('MANIFEST_MISMATCH');
 const groups=[];
 for(const [i,s] of review.segments.entries()){
  if(s.sequence!==i+1||s.parent_sequence!==(i?i:null)||s.kind!==(s.record_id?'DISCOVERY':'SUMMARY')||s.asset_sha256!==assetHash(s)||!validText(s.text))fail('SEGMENT_MISMATCH');
  if(s.discovery_part===1)groups.push({id:s.record_id,count:s.discovery_parts,seen:0});
  const group=groups.at(-1);
  if(!group||group.id!==s.record_id||s.discovery_part!==++group.seen||s.discovery_parts!==group.count)fail('DISCOVERY_ORDER_MISMATCH');
  if(!Array.isArray(s.source_links)||s.source_links.some(url=>{try{const u=new URL(url);return u.protocol!=='https:'||u.username||u.password}catch{return true}}))fail('SOURCE_LINK_INVALID');
  if(s.source_links.some(url=>!(review.source_links_by_record?.[s.record_id??'SUMMARY']??[]).includes(url)))problems.push('LINK_NOT_IN_PUBLISHED_EVIDENCE:'+s.sequence);
  if(!i&&review.graphic_required&&!s.media)problems.push('MAIN_GRAPHIC_MISSING');
  if(s.media){
   try{const {bytes,mime}=graphic({kind:'X',destination_id:'x',body:s.text,visual_base64:s.media.base64,visual_sha256:s.media.sha256,visual_mime:s.media.mime});if(mime!==s.media.mime||bytesHash(bytes)!==s.media.sha256)fail('GRAPHIC_MISMATCH');}catch{problems.push('GRAPHIC_BYTES_INVALID:'+s.sequence)}
  }
 }
 if(groups.some(g=>g.seen!==g.count)||!same(groups.map(g=>g.id),[null,...review.discovery_ids]))fail('COVERAGE_INCOMPLETE');
 for(const id of review.discovery_ids)if(!review.segments.some(s=>s.record_id===id&&s.source_links.length))problems.push('SOURCE_LINKS_MISSING:'+id);
 return problems;
}
// Manifest includes segment hashes, but excludes its own digest.
function seal(review){review.segments=review.segments.map(s=>({...s,asset_sha256:assetHash(s)}));review.manifest_sha256=manifest(review);return review;}
function createV3AudienceReview({store,loadPublishedBytes,clock=()=>Date.now(),threadMode='FULL_EVIDENCE'}={}){
 if(!['FULL_EVIDENCE','CONCISE'].includes(threadMode))fail('THREAD_MODE_INVALID');
 if(!store?.mutate||!store.adapter?.read||typeof loadPublishedBytes!=='function')fail('V3_REVIEW_DEPENDENCIES_REQUIRED');
 let publicationRowsReader=null;
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
  // The scanner UI does not expose every checkpoint in its history index.
  // Link the exact published artifact rather than an unsupported date route.
  const scanUrl='https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-'+scan.snapshot_date+'.json';
  const thread=(threadMode==='CONCISE'?draftConciseThread:draftFullScanThread)({document,scanUrl});
  const source_links_by_record=Object.fromEntries(document.records.map(record=>[record.id,[...(record.evidence??[]).map(e=>e.url).filter(u=>typeof u==='string'),scanUrl]]));
  source_links_by_record.SUMMARY=[...new Set([...Object.values(source_links_by_record).flat(),'https://emradar.net/'])];
  const main=state.assets?.x?.asset;
  const segments=thread.segments.map((s,i)=>({...s,record_id:s.record_id??null,parent_sequence:i?i:null,source_links:i?(document.records[i-1].evidence??[]).map(e=>e.url).filter(u=>typeof u==='string'):[],media:null}));
  // Preserve the saved evidence-bound graphic only with its exact saved text.
  if(threadMode==='FULL_EVIDENCE'&&main?.body){segments[0].text=main.body+'\n\nAcross the published scan:\n'+document.records.map(r=>r.theme||r.title||r.id).join(' · ')+'\n\n'+segments[0].text+'\nEMRADAR: https://emradar.net/';segments[0].source_links=[...new Set(document.records.flatMap(r=>(r.evidence??[]).map(e=>e.url)).filter(u=>typeof u==='string'&&main.body.includes(u)))];}
  if(main?.visual_base64||main?.visual_url?.startsWith('data:image')){try{const {bytes,mime}=graphic(main);segments[0].media={base64:bytes.toString('base64'),mime,sha256:main.visual_sha256,provenance:{campaign_id:campaignId,v3_asset_sha256:hash(main)}};}catch{}}
  const review=seal({campaign_id:campaignId,review_id:randomUUID(),scan,source_sha256:scan.artifact_sha256,all_discovery_ids:thread.record_ids,excluded_discovery_ids:[],discovery_ids:thread.record_ids,source_links_by_record,graphic_required:true,segments:threadMode==='CONCISE'?segments.map((s,i)=>({...s,sequence:i+1,parent_sequence:i||null,discovery_part:1,discovery_parts:1,source_links:extractUrls(s.text)})):expandSegments(segments)});
  await store.mutate(campaignId,current=>{
   if(!same(identity(current),scan)||current.deliveries?.x||current.decisions?.x)fail('PREPARATION_STALE');
   if(!current.audience_x_review){current.audience_x_review=review;current.events??=[];current.events.push({type:'X_THREAD_PREPARED',review_id:review.review_id,manifest_sha256:review.manifest_sha256});}
   return current;
  });
  return (await store.adapter.read(campaignId)).value.audience_x_review;
 }
 async function view(campaignId){
  try{
   const existing=(await store.adapter.read(campaignId))?.value;
   if(!existing?.audience_x_review&&(existing?.decisions?.x||existing?.deliveries?.x))return null;
   const review=await prepare(campaignId),state=(await store.adapter.read(campaignId)).value,problems=validate(review,state);
   try{await verifyGraphicBytes(review)}catch{problems.push('GRAPHIC_DECODE_FAILED')}
   const progress=publicationRowsReader?(await publicationRowsReader(campaignId)).map(row=>({sequence:row.sequence,status:row.status,post_id:row.receipt_id,parent_post_id:row.parent_receipt_id,updated_at:row.updated_at})):[];
   return {...review,problems,ready:!problems.length,graphic_choices:savedGraphics(state),approval:state.audience_x_approval??null,publication_started:state.audience_x_publication_started??null,publication:state.audience_x_publication??null,publication_progress:progress,research:state.audience_x_research??null,observation:state.audience_x_observation??null};
  }catch(error){return {ready:false,problems:[/^AUDIENCE_[A-Z0-9_]+$/.test(error.message)?error.message:'AUDIENCE_PREVIEW_UNAVAILABLE'],segments:[]};}
 }
 async function present(campaignId,sessionId,input){
  await verifyGraphicBytes((await store.adapter.read(campaignId))?.value?.audience_x_review);
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
  if(decision==='APPROVE')await verifyGraphicBytes((await store.adapter.read(campaignId))?.value?.audience_x_review);
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
  const exclude=changes&&Object.keys(changes).length===1&&typeof changes.exclude_record_id==='string';
  const replaceGraphic=changes&&Object.keys(changes).length===2&&changes.sequence===1&&typeof changes.graphic_sha256==='string';
  if(!exclude&&!replaceGraphic&&(!changes||Object.keys(changes).some(k=>!['sequence','text'].includes(k))||!Number.isInteger(changes.sequence)||typeof changes.text!=='string'||!validText(changes.text)))fail('REVISION_INVALID');
  return store.mutate(campaignId,state=>{
   const r=state?.audience_x_review;
   if(state.phase!=='PUBLICATION_REVIEW'||state.deliveries?.x||state.audience_x_publication_started)fail('REVISION_AFTER_DISTRIBUTION');
   validate(r,state);
   if(r.manifest_sha256!==fingerprint)fail('REVISION_STALE');
   state.audience_x_history??=[];state.audience_x_history.push(structuredClone(r));
   if(exclude){
    if(!r.discovery_ids.includes(changes.exclude_record_id))fail('EXCLUSION_INVALID');
    r.excluded_discovery_ids.push(changes.exclude_record_id);r.discovery_ids=r.discovery_ids.filter(id=>id!==changes.exclude_record_id);r.segments=r.segments.filter(s=>s.record_id!==changes.exclude_record_id).map((s,i)=>({...s,sequence:i+1,parent_sequence:i||null}));
   }else if(replaceGraphic){const media=savedGraphics(state).find(m=>m.sha256===changes.graphic_sha256);if(!media)fail('TRUSTED_GRAPHIC_REQUIRED');r.segments[0].media=media;}
   else{const segment=r.segments[changes.sequence-1];if(!segment)fail('REVISION_INVALID');segment.text=changes.text;segment.source_links=extractUrls(changes.text);}
   r.review_id=randomUUID();seal(r);delete state.audience_x_approval;delete state.audience_x_checks;state.audience_x_presentations={};
   state.events.push({type:'X_THREAD_REVISED',review_id:r.review_id,manifest_sha256:r.manifest_sha256});return state;
  });
 }
 async function verify({campaign_id,approved_thread}={}){
  const state=(await store.adapter.read(campaign_id))?.value,r=state?.audience_x_review,a=state?.audience_x_approval;
  if(!r||!a||a.decision!=='APPROVE'||a.manifest_sha256!==r.manifest_sha256||a.review_id!==r.review_id)return false;
  if(!state.events?.some(e=>e.type==='OWNER_X_THREAD_DECISION'&&e.id===a.id&&same(e,a)))return false;
  const access=(await store.adapter.read('review:'+campaign_id))?.value;
  const records=[access,...(access?.previous_reviews??[])];
  if(!records.some(item=>item?.token_hash===a.review_access_hash&&item.status==='CONSUMED'&&item.owner_session?.id===a.session_id&&item.owner_session.role==='OWNER'&&item.owner_session.campaign_id===campaign_id&&item.owner_session.revoked_at===null&&a.at<item.owner_session.expires_at))return false;
  try{
   if(validate(r,state).length)return false;
   await verifyGraphicBytes(r);
  }catch{return false;}
  if(approved_thread&&!same(approved_thread,r))return false;
  const bytes=await loadPublishedBytes(r.scan);
  if(!Buffer.isBuffer(bytes)||bytesHash(bytes)!==r.source_sha256)return false;
  const document=JSON.parse(bytes.toString('utf8'));
  return document.publication_state==='PUBLISHED'&&same(document.records.map(record=>record.id),r.all_discovery_ids);
 }
 return {view,present,decide,revise,verify,prepare,loadSourceBytes:loadPublishedBytes,setPublicationRowsReader:reader=>{publicationRowsReader=reader;}};
}
module.exports={createV3AudienceReview,hash,manifest,validate};

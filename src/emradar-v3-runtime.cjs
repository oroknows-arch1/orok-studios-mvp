'use strict';
const {Pool}=require('pg');
const {createHash}=require('node:crypto');
const {readFileSync,readdirSync}=require('node:fs');
const path=require('node:path');
const {createV3IsolatedWiring}=require('./emradar-v3-wiring.cjs');

const ATTESTATION_DIR=path.join(__dirname,'../vendor/emradar-v3/verification');
const SCAN_ORIGIN='https://emerging-markets-radar.onrender.com';
const SCAN_INDEX_URL=SCAN_ORIGIN+'/data/archive-index.json';
const FIXED_X_TEMPLATE_VERSION='emradar-formation-card-v2';
const REVIEW_PATHS=new Set(['/review/access','/api/review/request-access','/api/review/exchange','/api/review/view','/api/review/decision','/api/review/group','/api/review/revise','/api/review/discover','/api/review/release','/api/review/x/connect','/api/review/x/callback','/api/review/x/status']);

function loadPublishedScans(attestationDir=ATTESTATION_DIR){
 return readdirSync(attestationDir).filter(name=>/^publication-\d{4}-\d{2}-\d{2}\.json$/.test(name)).map(name=>name.slice(12,-5)).filter(date=>{
  try{readFileSync(path.join(attestationDir,'downstream-release-attestation-'+date+'.json'));return true;}catch{return false;}
 }).sort().reverse().map(snapshotDate=>{
  const publicationRecord=JSON.parse(readFileSync(path.join(attestationDir,'publication-'+snapshotDate+'.json'),'utf8'));
  const releaseAttestation=JSON.parse(readFileSync(path.join(attestationDir,'downstream-release-attestation-'+snapshotDate+'.json'),'utf8'));
  const expectedSha256=publicationRecord?.public_verification?.artifact_sha256;
  const archiveUrl='https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-'+snapshotDate+'.json';
  return {snapshotDate,expectedSha256,liveUrl:archiveUrl,archiveUrl,publicationRecord,releaseAttestation};
 });
}
// Refresh the public source at execution time; immutable archive bytes are
// independently checked by verifyPublishedScan before any campaign is created.
async function refreshPublishedScans({fetcher=fetch}={}){
 const liveUrl=SCAN_ORIGIN+'/data/discovery.json';
 const response=await fetcher(liveUrl,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/json','cache-control':'no-cache'}});
 if(!response.ok)throw Error('SCAN_HTTP_'+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>10*1024*1024)throw Error('SCAN_TOO_LARGE');
 const document=JSON.parse(bytes.toString('utf8'));
 if(document.publication_state!=='PUBLISHED'||!/^\d{4}-\d{2}-\d{2}$/.test(document.snapshot_date||''))throw Error('SCAN_NOT_PUBLISHED');
 return [{snapshotDate:document.snapshot_date,expectedSha256:createHash('sha256').update(bytes).digest('hex'),liveUrl,
 archiveUrl:SCAN_ORIGIN+'/data/checkpoints/discovery-'+document.snapshot_date+'.json'}];
}
async function enumeratePublishedScans({fetcher=fetch,indexUrl=SCAN_INDEX_URL}={}){
 if(indexUrl!==SCAN_INDEX_URL)throw Error('UNTRUSTED_SCAN_INDEX');
 const getJson=async url=>{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.origin!==SCAN_ORIGIN)throw Error('UNTRUSTED_SCAN_HOST');
  const response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/json','cache-control':'no-cache'}});
  if(response.status===404)return null;
  if(!response.ok)throw Error('SCAN_HTTP_'+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>10*1024*1024)throw Error('SCAN_TOO_LARGE');
  return JSON.parse(bytes.toString('utf8'));
 };
 const index=await getJson(indexUrl);
 if(!index||!Array.isArray(index.scans)||!Array.isArray(index.snapshots))throw Error('SCAN_ARCHIVE_INDEX_INVALID');
 const entries=new Map(),blocked=[];
 for(const entry of [...index.scans,...index.snapshots]){
  const date=entry?.snapshot_date,pathValue=entry?.path;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){blocked.push({snapshotDate:null,reason:'INVALID_ARCHIVE_DATE'});continue;}
  const expectedPath=`data/checkpoints/discovery-${date}.json`;
  if(pathValue!==expectedPath){blocked.push({snapshotDate:date,reason:'ARCHIVE_PATH_NOT_VERIFIABLE'});continue;}
  const previous=entries.get(date);
  if(previous&&previous.path!==pathValue)throw Error('SCAN_ARCHIVE_INDEX_CONFLICT');
  entries.set(date,{snapshotDate:date,path:pathValue});
 }
 if(entries.size>120)throw Error('SCAN_ARCHIVE_INDEX_TOO_LARGE');
 const candidates=[...entries.values()].sort((a,b)=>a.snapshotDate.localeCompare(b.snapshotDate));
 const verified=await Promise.all(candidates.map(async candidate=>{
  const date=candidate.snapshotDate;
  const archiveUrl=SCAN_ORIGIN+'/'+candidate.path;
  const publicationRecord=await getJson(`${SCAN_ORIGIN}/verification/publication-${date}.json`);
  const releaseAttestation=await getJson(`${SCAN_ORIGIN}/verification/downstream-release-attestation-${date}.json`);
  let expectedSha256=publicationRecord?.public_verification?.artifact_sha256;
  const authorized=publicationRecord?.snapshot_date===date&&
   publicationRecord?.public_verification?.verification_contract==='live-reader-exact-identity-v2'&&
   publicationRecord?.public_verification?.archive_data_url===archiveUrl&&
   publicationRecord?.gates?.public_snapshot_verification==='PASS'&&
   publicationRecord?.downstream_release_allowed===true&&
   releaseAttestation?.snapshot_date===date&&releaseAttestation?.source_path===candidate.path&&
   releaseAttestation?.source_sha256===expectedSha256&&releaseAttestation?.publication_state==='PUBLISHED'&&
   releaseAttestation?.downstream_release_allowed===true&&releaseAttestation?.native_gates?.publication==='PASS'&&
   releaseAttestation?.attested_by==='AUTHORIZED_SOURCE_RELEASE_REVIEW'&&
   releaseAttestation?.campaign_authority?.required_stop==='PUBLICATION_REVIEW'&&
   releaseAttestation?.campaign_authority?.external_publication_allowed===false&&
   /^[a-f0-9]{64}$/.test(expectedSha256||'');
  if(!authorized){
   // A published source artifact is an independent authorization and integrity
   // path only when both optional sidecars are absent. Never override a partial,
   // contradictory or explicitly denied attestation.
   if(publicationRecord||releaseAttestation){blocked.push({snapshotDate:date,reason:'PUBLICATION_ATTESTATION_INVALID'});return null;}
   const response=await fetcher(archiveUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/json','cache-control':'no-cache'}});
   if(response.status===404){blocked.push({snapshotDate:date,reason:'PUBLICATION_ATTESTATION_UNAVAILABLE'});return null;}
   if(!response.ok){blocked.push({snapshotDate:date,reason:'PUBLICATION_ARCHIVE_UNAVAILABLE'});return null;}
   const bytes=Buffer.from(await response.arrayBuffer());
   if(bytes.length>10*1024*1024)throw Error('SCAN_TOO_LARGE');
   const exact=JSON.parse(bytes.toString('utf8'));
   if(exact.snapshot_date!==date||exact.publication_state!=='PUBLISHED'){
    blocked.push({snapshotDate:date,reason:'PUBLICATION_ARCHIVE_IDENTITY_INVALID'});return null;
   }
   expectedSha256=createHash('sha256').update(bytes).digest('hex');
   return {snapshotDate:date,expectedSha256,liveUrl:archiveUrl,archiveUrl,publicationAuthorization:'PUBLISHED_ARCHIVE_EXACT_SHA256'};
  }
  return {snapshotDate:date,expectedSha256,liveUrl:SCAN_ORIGIN+'/data/discovery.json',archiveUrl,publicationRecord,releaseAttestation};
 }));
 const eligible=verified.filter(Boolean).sort((a,b)=>a.snapshotDate.localeCompare(b.snapshotDate));
 Object.defineProperty(eligible,'blocked',{value:blocked,enumerable:false});
 return eligible;
}
function mergeCurrentPublishedScan(archived,current){
 const candidates=new Map(archived.map(item=>[item.snapshotDate,item]));
 for(const item of current){
  const existing=candidates.get(item.snapshotDate);
  if(existing&&existing.expectedSha256!==item.expectedSha256)throw Error('SCAN_ARCHIVE_IDENTITY_CONFLICT');
  if(!existing)candidates.set(item.snapshotDate,item);
 }
 const merged=[...candidates.values()].sort((a,b)=>a.snapshotDate.localeCompare(b.snapshotDate));
 Object.defineProperty(merged,'blocked',{value:archived.blocked??[],enumerable:false});
 return merged;
}
// Historical archives are verified from the original published source, not local attestations.
async function fetchHistoricalPublishedScan(snapshotDate){
 if(snapshotDate!=='2026-10-10')throw Error('HISTORICAL_SCAN_NOT_BUNDLED');
 const bytes=readFileSync(path.join(ATTESTATION_DIR,'discovery-2026-10-10.json'));
 const document=JSON.parse(bytes.toString('utf8'));
 if(document.publication_state!=='PUBLISHED'||document.snapshot_date!==snapshotDate)throw Error('HISTORICAL_SCAN_NOT_PUBLISHED');
 const expectedSha256=createHash('sha256').update(bytes).digest('hex');
 const archiveUrl='https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-'+snapshotDate+'.json';
 return {snapshotDate,expectedSha256,liveUrl:archiveUrl,archiveUrl,bundledBytes:bytes};
}
const campaignIdFor=published=>'v3-'+createHash('sha256').update(published.snapshotDate+':'+published.expectedSha256).digest('hex').slice(0,32);
async function selectNextPublishedScan({published,readCampaign}){
 for(const candidate of [...published].sort((a,b)=>a.snapshotDate.localeCompare(b.snapshotDate))){
  const existing=await readCampaign(campaignIdFor(candidate));
  if(existing?.phase!=='PUBLICATION_REVIEW')return {...candidate,resume:Boolean(existing)};
 }
 return null;
}
// Continue already verified, persisted scans independently of new-scan intake.
// Reopening publication review is not evidence of discovery exhaustion.
async function resumePendingDiscovery({pool,service}){
 const {rows}=await pool.query(`SELECT c.campaign_id FROM v3_campaign_state c
  LEFT JOIN v3_campaign_state r ON r.campaign_id='review:'||c.campaign_id
  WHERE c.payload->>'phase' IN ('PUBLICATION_REVIEW','ASSETS_PREPARED')
  AND c.payload->'preparation_input'->'document' IS NOT NULL
  AND COALESCE(c.payload->'review_completion'->>'complete','false')<>'true'
  AND r.campaign_id IS NULL
  ORDER BY c.updated_at ASC,c.campaign_id ASC LIMIT 1`);
 const campaignId=rows[0]?.campaign_id;if(!campaignId)return null;
 const client=await pool.connect();
 try{
  const lock=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[campaignId]);
  if(!lock.rows[0]?.acquired)return {campaignId,status:'SCAN_PREPARATION_IN_PROGRESS'};
  const state=(await service.store.adapter.read(campaignId))?.value;
  if(!['PUBLICATION_REVIEW','ASSETS_PREPARED'].includes(state?.phase)||state.review_completion?.complete===true||!state.preparation_input?.document)return null;
  const resumed=await service.resumeIntelligentDiscovery(campaignId,{notifyOwner:false});
  const completion=await service.reviewCompletion(campaignId);
  if(!completion.complete)return {...resumed,...completion,recovery:'INCOMPLETE'};
  const notification=(await service.workflow.issue(campaignId)).status;
  return {...resumed,...completion,notification,recovery:'COMPLETE'};
 }finally{await client.query('SELECT pg_advisory_unlock(hashtext($1))',[campaignId]);client.release();}
}
async function runNextPublishedCampaign({published,readCampaign,startCampaign,verify,discover,persistDestinations,prepareAndNotify}){
 const selected=await selectNextPublishedScan({published,readCampaign});
 if(!selected)return {status:'NO_UNPROCESSED_SCAN'};
 const verified=await verify(selected);
 const campaignId=await startCampaign(verified.scan);
 if(!selected.resume){
  const destinations=await discover({scan:verified.scan,document:verified.document});
  await persistDestinations(campaignId,destinations);
 }
 const result=await prepareAndNotify(selected);
 return {...result,campaignId,snapshotDate:selected.snapshotDate,discovery:selected.resume?'RESUMED':'COMPLETE'};
}
async function runReleaseOnce({adapter,key,run,isComplete=()=>true}){
 const claimed=await adapter.compareAndSwap(key,null,{status:'STARTED',started_at:new Date().toISOString()});
 if(!claimed)return {status:'RELEASE_ALREADY_EXECUTED'};
 try{
  const result=await run();
  await adapter.compareAndSwap(key,1,{status:isComplete(result)?'COMPLETE':'BLOCKED',completed_at:new Date().toISOString(),result});
  return result;
 }catch(error){throw error;}
}
async function runIncompleteCampaignRecovery({adapter,service,campaignId,key='v3-recovery:2026-10-15-complete-publication-review-v1'}){
 const current=await service.reviewCompletion(campaignId);
 if(current.complete)return {campaignId,status:'PUBLICATION_REVIEW',...current,recovery:'ALREADY_COMPLETE'};
 return runReleaseOnce({adapter,key,run:async()=>{
  const resumed=await service.resumeIntelligentDiscovery(campaignId);
  const completion=await service.reviewCompletion(campaignId);
  if(!completion.complete)throw Error('V3_PUBLICATION_REVIEW_INCOMPLETE');
  const notification=(await service.workflow.issue(campaignId)).status;
  return {...resumed,...completion,notification,recovery:'COMPLETE'};
 }});
}

async function runOwnerInvitationOnce({adapter,workflow,inspectInbox,campaignId,reviewOrigin,key}){
 return runReleaseOnce({adapter,key,isComplete:result=>result.status==='OWNER_REVIEW_READY',run:async()=>{
  await workflow.issue(campaignId);
  const review=(await adapter.read('review:'+campaignId))?.value;
  if(review?.status!=='NOTIFIED'||review.notification_receipt?.recipient!=='sean@emradar.net')throw Error('V3_OWNER_NOTIFICATION_UNCONFIRMED');
  const inbox=await inspectInbox({provider_id:review.notification_receipt.provider_id,campaignId,reviewOrigin,token_hash:review.token_hash});
  return {status:inbox.status==='PASS'&&inbox.link_ready?'OWNER_REVIEW_READY':'OWNER_REVIEW_BLOCKED',recipient:'sean@emradar.net',smtp:'PASS',inbox};
 }});
}

async function restoreOwnerReviewAccess({adapter,workflow,inspectMailbox,inspectInbox,campaignId,reviewOrigin,key}){
 return runReleaseOnce({adapter,key,isComplete:result=>result.status==='OWNER_REVIEW_READY',run:async()=>{
  const review=(await adapter.read('review:'+campaignId))?.value;
  if(!review?.notification_receipt?.provider_id||review.notification_receipt.recipient!=='sean@emradar.net')return {status:'OWNER_REVIEW_BLOCKED',reason:'CANONICAL_PRIOR_INVITATION_REQUIRED',emails_sent:0};
  const input={provider_id:review.notification_receipt.provider_id,campaignId,reviewOrigin,token_hash:review.token_hash};
  const routing=await inspectMailbox(input);
  await adapter.compareAndSwap(key+':mailbox',null,routing);
  if(routing.status!=='PASS'||!routing.inbox)return {status:'OWNER_REVIEW_BLOCKED',reason:routing.reason??'INVITATION_FILED_OUTSIDE_INBOX',routing,emails_sent:0};
  // A live unconsumed invitation is never replaced by another message.
  if(!['CONSUMED','EXPIRED'].includes(review.status)&&review.expires_at>Date.now())return {status:'OWNER_REVIEW_READY',smtp:'PASS',inbox:routing,emails_sent:0};
  const fresh=await runOwnerInvitationOnce({adapter,workflow,inspectInbox,campaignId,reviewOrigin,key:key+':fresh'});
  return {...fresh,routing,emails_sent:1};
 }});
}

// Activation is opt-in and fails before mounting any routes if required
// configuration is missing. The only outbound SMTP operation is owner review.
async function mountV3PreparationReview({app,env=process.env,openai,fetcher=fetch,
 createPool=options=>new Pool(options),createTransport,setReviewHandler}={}){
 if(env.EMRADAR_V3_PREPARATION_ENABLED!=='true')return {enabled:false};
 if(typeof app?.post!=='function')throw Error('V3_APP_REQUIRED');
 // Autonomous discovery must never silently inherit the production database.
 if(env.EMRADAR_V3_AUTONOMOUS_DISCOVERY==='true'&&!env.EMRADAR_V3_DATABASE_URL)
  throw Error('V3_DISCOVERY_ISOLATED_DATABASE_REQUIRED');
 const databaseUrl=env.EMRADAR_V3_DATABASE_URL||env.DATABASE_URL;
 if(!databaseUrl||!env.EMRADAR_V3_API_TOKEN||!env.EMRADAR_V3_REVIEW_ORIGIN)
  throw Error('V3_ACTIVATION_CONFIG_REQUIRED');
 if(!openai?.chat?.completions?.create)throw Error('V3_OPENAI_PROVIDER_REQUIRED');
 if(env.EMRADAR_V3_AUTONOMOUS_DISCOVERY==='true'&&typeof openai?.responses?.create!=='function')
  throw Error('V3_DISCOVERY_SEARCH_PROVIDER_REQUIRED');
 if(typeof setReviewHandler!=='function')throw Error('V3_REVIEW_HTTP_REQUIRED');
 let reviewedLinks;
 try{reviewedLinks=JSON.parse(env.EMRADAR_V3_APPROVED_LINKS_JSON||'[]');}
 catch{throw Error('V3_APPROVED_LINKS_INVALID');}
 if(!Array.isArray(reviewedLinks))throw Error('V3_APPROVED_LINKS_INVALID');
 const {createOpenAiPreparationReviewService}=await import('../vendor/emradar-v3/src/preparation-review-service.js');
 const {createReviewServer}=await import('../vendor/emradar-v3/src/http.js');
 const pool=createPool({connectionString:databaseUrl});
 try{
  const integration=createV3IsolatedWiring({
   pool,token:env.EMRADAR_V3_API_TOKEN,reviewOrigin:env.EMRADAR_V3_REVIEW_ORIGIN,env,createTransport,fetcher
  });
  await integration.initialize();
  const notify=async({recipient,campaignId,link})=>{
   const result=await integration.handle({operation:'owner-notification',payload:{
    version:'EMRADAR_V3',kind:'OWNER_REVIEW',to:recipient,campaign_id:campaignId,private_review_url:link
   }});
   return {accepted:result.accepted,provider_id:result.provider_id,recipient,campaign_id:campaignId};
  };
  const service=await createOpenAiPreparationReviewService({
   pool,openai,notify,reviewOrigin:env.EMRADAR_V3_REVIEW_ORIGIN,reviewedLinks,fetcher,
   autonomousDiscovery:env.EMRADAR_V3_AUTONOMOUS_DISCOVERY==='true'
  });
  const runRegeneration=async(campaignId,destinationId)=>{
   const client=await pool.connect(),lockKey='v3-review-regeneration:'+campaignId+':'+destinationId;
   try{
    const lock=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[lockKey]);
    if(!lock.rows[0]?.acquired)return {status:'REGENERATION_IN_PROGRESS',campaignId,destinationId};
    let state=(await service.store.adapter.read(campaignId))?.value,action=state?.review_actions?.[destinationId];
    if(!action||!['PENDING','RUNNING','OWNER_REVIEW_PENDING'].includes(action.status))return {status:action?.status??'NO_REGENERATION_REQUEST',campaignId,destinationId};
    const requestId=action.request_id;
    let revision=action.status==='OWNER_REVIEW_PENDING'?{revisionId:action.revision_id}:null;
    try{
     if(!revision){
      await service.updateRegenerationStatus(campaignId,destinationId,requestId,'RUNNING',{started_at:action.started_at??new Date().toISOString()});
      revision=await service.regenerateRejectedAsset(campaignId,destinationId,requestId);
     }
     const notified=await service.workflow.issue(campaignId,{revisionId:revision.revisionId});
     await service.updateRegenerationStatus(campaignId,destinationId,requestId,'COMPLETE',{completed_at:new Date().toISOString(),owner_notification: notified.status});
     return {...revision,status:'COMPLETE',owner_notification:notified.status};
    }catch(error){
     const code=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'REGENERATION_FAILED';
     await service.updateRegenerationStatus(campaignId,destinationId,requestId,code==='REVIEW_NOTIFICATION_AMBIGUOUS'?'NOTIFICATION_AMBIGUOUS':'FAILED',{error_code:code,failed_at:new Date().toISOString()});
     throw Error(code);
    }
   }finally{
    await client.query('SELECT pg_advisory_unlock(hashtext($1))',[lockKey]);client.release();
   }
  };
  const runPendingRegenerations=async({limit=50}={})=>{
   if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('REGENERATION_BATCH_LIMIT_INVALID');
   const failedTemplateCampaign='v3-5d73d453fb02fa0da4287e23834f92db';
   const failedTemplateState=(await service.store.adapter.read(failedTemplateCampaign))?.value;
   const failedTemplateAction=failedTemplateState?.review_actions?.x;
   const failedTemplateAsset=failedTemplateState?.assets?.x?.asset;
   if(failedTemplateState?.phase==='PUBLICATION_REVIEW'&&failedTemplateAction?.status==='FAILED'&&failedTemplateAction?.error_code==='V3_X_VISUAL_QUALITY_FAILED'&&failedTemplateAction?.feedback?.trim()&&!failedTemplateState.deliveries?.x&&!failedTemplateAction.template_recovery_attempted_at&&failedTemplateAsset?.visual_brand_version!==FIXED_X_TEMPLATE_VERSION){
    await service.store.mutate(failedTemplateCampaign,current=>{
     const action=current?.review_actions?.x,asset=current?.assets?.x?.asset;
     if(current?.phase!=='PUBLICATION_REVIEW'||action?.status!=='FAILED'||action?.error_code!=='V3_X_VISUAL_QUALITY_FAILED'||!action?.feedback?.trim()||current.deliveries?.x||action.template_recovery_attempted_at||asset?.visual_brand_version===FIXED_X_TEMPLATE_VERSION)return current;
     const attemptedAt=new Date().toISOString();
     current.review_actions.x={...action,status:'PENDING',template_recovery_attempted_at:attemptedAt,updated_at:attemptedAt};
     current.events??=[];current.events.push({type:'X_FIXED_TEMPLATE_REGENERATION_REQUEUED',destination_id:'x',request_id:action.request_id,template:FIXED_X_TEMPLATE_VERSION,at:attemptedAt});
     return current;
    });
   }
   const refreshed=await service.refreshUnreviewedXVisual?.(failedTemplateCampaign);
   if(refreshed)await service.workflow.issue(failedTemplateCampaign,{revisionId:'fixed-template-v2'});
   const {rows}=await pool.query(`SELECT s.campaign_id, a.key AS destination_id
    FROM v3_campaign_state s CROSS JOIN LATERAL jsonb_each(COALESCE(s.payload->'review_actions','{}'::jsonb)) a
    WHERE s.payload->>'phase'='PUBLICATION_REVIEW' AND a.value->>'status' IN ('PENDING','RUNNING','OWNER_REVIEW_PENDING')
    ORDER BY s.updated_at ASC, s.campaign_id ASC, a.key ASC LIMIT $1`,[limit]);
   const results=[];
   for(const row of rows){
    try{results.push(await runRegeneration(row.campaign_id,row.destination_id));}
    catch(error){results.push({campaignId:row.campaign_id,destinationId:row.destination_id,status:'FAILED',reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'REGENERATION_FAILED'});}
   }
   return {processed:results.length,results};
  };
  console.info('V3_DISTRIBUTION_CAPABILITIES '+JSON.stringify({email_release:true,x_release:env.EMRADAR_V3_X_PUBLISH_ENABLED==='true',x_client_id_present:Boolean(env.X_CLIENT_ID),x_client_secret_present:Boolean(env.X_CLIENT_SECRET),x_token_encryption_configured:Boolean(env.EMRADAR_V3_X_TOKEN_KEY)}));
  let releaseApprovedEmail;
  const reviewServer=createReviewServer({workflow:service.workflow,xAuth:integration.xAuth,publishing:{email:{enabled:true},x:{enabled:env.EMRADAR_V3_X_PUBLISH_ENABLED==='true',reason:env.EMRADAR_V3_X_PUBLISH_ENABLED==='true'?null:'X publishing is disabled.'}},runDiscovery:campaignId=>service.resumeIntelligentDiscovery(campaignId),runRegeneration,releaseEmail:input=>releaseApprovedEmail(input)});
  setReviewHandler((req,res,next)=>{
   if(!REVIEW_PATHS.has(req.url.split('?')[0]))return next();
   reviewServer.emit('request',req,res);
  });
  app.post('/emradar/v3/owner-notification',(req,res)=>{
   req.params={...req.params,operation:'owner-notification'};
   return integration.route(req,res);
  });
  const {verifyPublishedScan}=await import('../vendor/emradar-v3/src/scan-intake.js');
  const {normalizePublishedEvidence}=await import('../vendor/emradar-v3/src/scan-evidence-adapter.js');
  const published=async()=>mergeCurrentPublishedScan(await enumeratePublishedScans({fetcher}),await refreshPublishedScans({fetcher}));
  const verify=async selected=>{
   const sourceFetcher=selected.bundledBytes?async url=>{
    if(url!==selected.archiveUrl)throw Error('UNTRUSTED_SCAN_URL');
    return {ok:true,status:200,arrayBuffer:async()=>selected.bundledBytes};
   }:fetcher;
   const verified=await verifyPublishedScan({...selected,fetcher:sourceFetcher});
   return {...verified,document:normalizePublishedEvidence(verified.document)};
  };
  const choose=async()=>selectNextPublishedScan({published:await published(),readCampaign:async id=>(await service.store.adapter.read(id))?.value});
  const refreshDirectory=async(selected)=>{
   if(env.EMRADAR_V3_AUTONOMOUS_DISCOVERY!=='true')throw Error('V3_AUTONOMOUS_DISCOVERY_DISABLED');
   selected=selected??(await choose());
   if(!selected)return {status:'NO_UNPROCESSED_SCAN',destination_count:0,editorial_count:0};
   const campaignId=campaignIdFor(selected),existing=(await service.store.adapter.read(campaignId))?.value;
   if(['PUBLICATION_REVIEW','ASSETS_PREPARED'].includes(existing?.phase))return service.resumeIntelligentDiscovery(campaignId);
   return runCampaign();
  };
  // Newest verified unprocessed scan; review invitation is issued only
  // after durable PUBLICATION_REVIEW. Never delivers to destinations.
  const runCampaign=async(snapshotDate)=>{
   // Retry one persisted incomplete review per hourly poll. A failure is logged
   // and isolated so it cannot block intake of another independently valid scan.
   if(!snapshotDate){
    try{
     const recovered=await resumePendingDiscovery({pool,service});
     if(recovered)console.log('V3_INCOMPLETE_REVIEW_RECOVERY',JSON.stringify(recovered));
    }catch(error){console.warn('V3_INCOMPLETE_REVIEW_RECOVERY_BLOCKED',/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'V3_REVIEW_RECOVERY_FAILED');}
   }
   // Recover a completed persisted review before attempting fresh archive intake.
   // The durable review record and database lock prevent duplicate invitations.
   const pending=await pool.query(`SELECT c.campaign_id FROM v3_campaign_state c
    LEFT JOIN v3_campaign_state r ON r.campaign_id='review:'||c.campaign_id
    WHERE c.payload->>'phase'='PUBLICATION_REVIEW'
      AND c.payload->'review_completion'->>'complete'='true'
      AND r.campaign_id IS NULL
    ORDER BY c.updated_at DESC LIMIT 1`);
   if(pending.rows[0]){
    const pendingId=pending.rows[0].campaign_id;
    const recoveryClient=await pool.connect();
    try{
     const lock=await recoveryClient.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',['owner-review:'+pendingId]);
     if(lock.rows[0]?.acquired){
      const current=(await service.store.adapter.read(pendingId))?.value;
      const priorReview=(await service.store.adapter.read('review:'+pendingId))?.value;
      if(current?.phase==='PUBLICATION_REVIEW'&&current.review_completion?.complete===true&&!priorReview){
       const outcome=await service.workflow.issue(pendingId);
       console.log('V3_OWNER_REVIEW_RECOVERY',JSON.stringify({campaignId:pendingId,status:outcome.status}));
      }
     }
    }finally{
     await recoveryClient.query('SELECT pg_advisory_unlock(hashtext($1))',['owner-review:'+pendingId]);
     recoveryClient.release();
    }
   }
   // Incomplete discovery must not monopolise campaign intake or owner review.
   // Existing discovery recovery remains available independently.
   // Historical runs require the source's paired release attestations and exact archive digest.
   // Never substitute the current live scan for a requested historical date.
   const available=await published();
   if(available.blocked?.length)console.warn('V3_ARCHIVE_ENTRIES_NOT_VERIFIABLE',JSON.stringify(available.blocked));
   const selected=snapshotDate?available.find(item=>item.snapshotDate===snapshotDate):await selectNextPublishedScan({published:available,readCampaign:async id=>(await service.store.adapter.read(id))?.value});
   if(!selected) return {status:snapshotDate?'SCAN_NOT_IN_VERIFIED_ARCHIVE':'NO_UNPROCESSED_SCAN',archive_unverified_dates:available.blocked?.map(item=>item.snapshotDate).filter(Boolean)??[]};
   const campaignId=campaignIdFor(selected);
   // Hold a database session lock through preparation. A crashed process releases
   // it automatically; all workers/restarts share the same durable scan identity.
   const client=await pool.connect();
   try{
    const lock=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[campaignId]);
    if(!lock.rows[0]?.acquired)return {status:'SCAN_PREPARATION_IN_PROGRESS',campaignId};
    const adapter=service.store.adapter;
    const prior=(await adapter.read(campaignId))?.value;
    const review=(await adapter.read('review:'+campaignId))?.value;
    if(prior?.phase==='PUBLICATION_REVIEW'&&review){
     const completion=await service.reviewCompletion(campaignId);
     if(completion.complete)return {campaignId,snapshotDate:selected.snapshotDate,status:'PUBLICATION_REVIEW',...completion,notification:review.status};
     // Discovery coverage is advisory after PUBLICATION_REVIEW; never make the
     // owner wait for contact research to finish before reviewing persisted assets.
     if(prior.discovery_coverage?.complete===false)console.warn('V3_DISCOVERY_COVERAGE_PENDING',campaignId);
    }
    // Preparation owns evidence research and discovery, preserving their order
    // and resuming persisted destinations instead of repeating completed work.
    return {...await service.prepareAndNotify(selected),snapshotDate:selected.snapshotDate,archive_unverified_dates:available.blocked?.map(item=>item.snapshotDate).filter(Boolean)??[]};
   }finally{
    await client.query('SELECT pg_advisory_unlock(hashtext($1))',[campaignId]);
    client.release();
   }
  };
  // One bounded verification of this discovery revision, using the existing
  // latest campaign. No notification, release, scan or content regeneration.
  const discoveryTestKey='v3-publication-first-discovery:2026-10-21-formation-coverage-v3';
  const latestResearchScan=(await published().catch(()=>[]))[0];
  const activeCampaignId='v3-df5b240c718018880410c03a4c392d64';
  const activeCampaignState=(await service.store.adapter.read(activeCampaignId))?.value;
  const researchCampaignId=activeCampaignState?activeCampaignId:(latestResearchScan?campaignIdFor(latestResearchScan):null);
  const researchState=researchCampaignId?(await service.store.adapter.read(researchCampaignId))?.value:null;
  if(['ASSETS_PREPARED','PUBLICATION_REVIEW'].includes(researchState?.phase)&&typeof service.excludeSourceInstitutions==='function')await service.excludeSourceInstitutions(researchCampaignId);
  const discoveryResearchPending=Boolean(['ASSETS_PREPARED','PUBLICATION_REVIEW'].includes(researchState?.phase)&&!(await service.store.adapter.read(discoveryTestKey)));
  const runDiscoveryResearchTest=()=>runReleaseOnce({adapter:service.store.adapter,key:discoveryTestKey,run:async()=>{
   const client=await pool.connect();
   try{
    const lock=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[researchCampaignId]);
    if(!lock.rows[0]?.acquired)return {status:'SCAN_PREPARATION_IN_PROGRESS',campaignId:researchCampaignId,complete:false};
    const result=await service.resumeIntelligentDiscovery(researchCampaignId,{notifyOwner:false});
    // Read-only production evidence for this bounded recovery. No owner token,
    // decision or distribution endpoint is used by these HTTP checks.
    const verification={deployed_commit:env.RENDER_GIT_COMMIT??null};
    for(const [key,pathname] of [['health_http_status','/health'],['review_http_status','/review/access?campaign='+encodeURIComponent(researchCampaignId)]]){
     try{const response=await fetcher(new URL(pathname,env.EMRADAR_V3_REVIEW_ORIGIN).href,{signal:AbortSignal.timeout(5000)});verification[key]=response.status;await response.body?.cancel();}
     catch{verification[key]='UNVERIFIED';}
    }
    return {...result,production_verification:verification};
   }finally{await client.query('SELECT pg_advisory_unlock(hashtext($1))',[researchCampaignId]);client.release();}
  },isComplete:result=>result.discovery_coverage?.complete===true});
  // Explicit owner release; no automatic publication or ambiguous retries.
  releaseApprovedEmail=require('./emradar-v3-release.cjs').createV3Release({service,integration,pool});
  app.post('/emradar/v3/release-email',async(req,res)=>{
   try{return res.status(200).json(await releaseApprovedEmail(req.body));}
   catch(error){return res.status(409).json({reason:/^V3_[A-Z0-9_]+$/.test(error.message)?error.message:'V3_RELEASE_FAILED'});}
  });
  app.post('/emradar/v3/discover',async(req,res)=>{
   if(req.headers.authorization!=='Bearer '+env.EMRADAR_V3_API_TOKEN)return res.status(403).json({reason:'V3_API_AUTH_REQUIRED'});
   try{return res.status(200).json(await refreshDirectory());}
   catch(error){return res.status(409).json({reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'V3_DISCOVERY_FAILED'});}
  });
  // Owner-triggered preparation: bearer-authenticated, fixed verified 13 Oct
  // artifact. No endpoint for external email delivery or X posting.
  app.post('/emradar/v3/prepare',async(req,res)=>{
   if(req.headers.authorization!=='Bearer '+env.EMRADAR_V3_API_TOKEN)
    return res.status(403).json({reason:'V3_API_AUTH_REQUIRED'});
   try{
    const requestedDate=req.body?.snapshotDate;
    if(requestedDate!==undefined && (typeof requestedDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)))throw Error('INVALID_HISTORICAL_SCAN_DATE');
    const result=await runCampaign(requestedDate);
    return res.status(200).json(result);
   }catch(error){
    return res.status(409).json({reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'V3_PREPARATION_FAILED'});
   }
  });
  // One read-only transport check for this repair. Does not claim delivery,
  // invoke preparation, append a message or call SMTP sendMail.
  const distributionPreflightKey='v3-email-distribution-preflight:2026-10-16-v1';
  const distributionPreflightPending=!(await service.store.adapter.read(distributionPreflightKey));
  const runDistributionPreflight=()=>runReleaseOnce({adapter:service.store.adapter,key:distributionPreflightKey,run:()=>integration.verifyMailTransport()});
  // One bounded owner-authorized writing review. Saved old drafts remain rejected;
  // two alternatives are stored separately without changing X or sending mail.
  const editorialCampaign='v3-2602ddf68a3ced8aeafb769fc928423f';
  const editorialRequest='owner-human-editorial-2026-10-16-v1';
  const editorialState=(await service.store.adapter.read(editorialCampaign))?.value;
  const editorialWritingReviewPending=Boolean(editorialState && editorialState.editorial_rewrite?.request_id!==editorialRequest && !await service.store.adapter.read('v3-verified-recipients:2026-10-16-v1'));
  const runEditorialWritingReview=async()=>{
   const client=await pool.connect();
   try{
    const lock=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[editorialCampaign]);
    if(!lock.rows[0]?.acquired)return {status:'EDITORIAL_REVIEW_IN_PROGRESS'};
    return await service.prepareEditorialAlternatives({campaignId:editorialCampaign,requestId:editorialRequest,angles:[
     'Focus on the proposed renewable-energy project appearing alongside electric-vehicle manufacturing and agricultural processing in the Free State programme. Explain why looking at these plans together is an interesting article for an African energy publication. Do not claim the projects are built, financed, physically connected or supplying one another.',
     'Lead with the question of what would turn the Free State renewable-energy announcement into a real project. Use the accompanying manufacturing and agricultural plans as context, offering an article that separates what has been announced from what still needs to happen. Do not invent milestones, demand, financing, jobs or completed work.'
    ]});
   }finally{await client.query('SELECT pg_advisory_unlock(hashtext($1))',[editorialCampaign]);client.release();}
  };
  const ownerInvitationKey='v3-owner-purelymail-invitation:2026-10-16-v1';
  const ownerInvitationPending=!(await service.store.adapter.read(ownerInvitationKey));
  const runOwnerInvitation=()=>runOwnerInvitationOnce({adapter:service.store.adapter,workflow:service.workflow,inspectInbox:integration.inspectOwnerInvitation,campaignId:editorialCampaign,reviewOrigin:env.EMRADAR_V3_REVIEW_ORIGIN,key:ownerInvitationKey});
  const replacementSourceCampaign='v3-cd8f16c860b64b5f39e2db0009f384ed';
  const replacementRequestId='group-first-review-2026-10-25-v1';
  const replacementKey='v3-replacement:'+replacementRequestId;
  const replacementRecord=await service.store.adapter.read(replacementKey);
  const replacementPending=replacementRecord?.value?.status!=='COMPLETE';
  const runReplacementReview=async()=>{
   const prior=await service.store.adapter.read(replacementKey);
   await service.store.adapter.compareAndSwap(replacementKey,prior?.version??null,{status:'STARTED',request_id:replacementRequestId,started_at:prior?.value?.started_at??new Date().toISOString()});
   const prepared=await service.prepareReplacementReview({sourceCampaignId:replacementSourceCampaign,requestId:replacementRequestId});
   let review=(await service.store.adapter.read('review:'+prepared.campaignId))?.value;
   if(!review)await service.workflow.issue(prepared.campaignId);
   review=(await service.store.adapter.read('review:'+prepared.campaignId))?.value;
   if(review?.status!=='NOTIFIED'||review.notification_receipt?.recipient!=='sean@emradar.net')throw Error('REPLACEMENT_INVITATION_UNCONFIRMED');
   const inbox=await integration.inspectOwnerInvitation({provider_id:review.notification_receipt.provider_id,campaignId:prepared.campaignId,reviewOrigin:env.EMRADAR_V3_REVIEW_ORIGIN,token_hash:review.token_hash});
   if(inbox.status!=='PASS')throw Error('REPLACEMENT_INVITATION_UNCONFIRMED');
   const state=(await service.store.adapter.read(prepared.campaignId)).value;
   const result={...prepared,status:'REVIEW_READY',invitation:{accepted:true,provider_id:review.notification_receipt.provider_id,recipient:'sean@emradar.net',inbox:inbox.status},shared_groups:Object.values(state.email_groups??{}).filter(group=>group.destination_ids.length>1).length,individual_proposals:Object.values(state.email_groups??{}).filter(group=>group.destination_ids.length===1).length};
   const latest=await service.store.adapter.read(replacementKey);await service.store.adapter.compareAndSwap(replacementKey,latest.version,{status:'COMPLETE',request_id:replacementRequestId,completed_at:new Date().toISOString(),result});return result;
  };
  const editorialStandardKey='v3-sfy-editorial-standard:2026-10-16-v1';
  const editorialStandardPending=!(await service.store.adapter.read(editorialStandardKey));
  const runEditorialStandard=()=>runReleaseOnce({adapter:service.store.adapter,key:editorialStandardKey,run:()=>service.refreshUnreviewedEditorialDrafts(editorialCampaign)});
  const recipientRecoveryKey='v3-verified-recipients:2026-10-16-v1';
  const recipientRecoveryPending=!(await service.store.adapter.read(recipientRecoveryKey));
  const runRecipientRecovery=()=>runReleaseOnce({adapter:service.store.adapter,key:recipientRecoveryKey,run:()=>service.recoverVerifiedRecipients(editorialCampaign)});
  const engineRepairKey='v3-engine-repair:2026-10-16-v1';
  const engineRepairPending=!(await service.store.adapter.read(engineRepairKey));
  const runEngineRepair=()=>runReleaseOnce({adapter:service.store.adapter,key:engineRepairKey,run:async()=>{
   const access=await service.testProductionContactAccess();
   const production_access={status:access.status,primary:access.primary,pages:access.pages,failures:access.failures,contacts_examined:access.contacts?.length??0,non_editorial_rejected:access.contacts?.filter(c=>!c.eligible).length??0};
   await service.store.adapter.compareAndSwap('v3-engine-access:2026-10-16-v1',null,production_access);
   return {...await service.resumeIntelligentDiscovery(editorialCampaign),production_access};
  }});
  const ownerAccessKey='v3-owner-access-restore:2026-10-16-v1';
  const ownerAccessPending=!(await service.store.adapter.read(ownerAccessKey));
  const runOwnerAccess=async()=>{
   const old=await service.store.adapter.read(ownerInvitationKey);
   if(old?.value.status==='COMPLETE'&&old.value.result?.status==='OWNER_REVIEW_BLOCKED')await service.store.adapter.compareAndSwap(ownerInvitationKey,old.version,{...old.value,status:'BLOCKED',completion_correction:{previous_status:'COMPLETE',reason:'INBOX_VERIFICATION_FAILED'}});
   return restoreOwnerReviewAccess({adapter:service.store.adapter,workflow:service.workflow,inspectMailbox:integration.inspectOwnerMailbox,inspectInbox:integration.inspectOwnerInvitation,campaignId:editorialCampaign,reviewOrigin:env.EMRADAR_V3_REVIEW_ORIGIN,key:ownerAccessKey});
  };
  return {replacementPending,runReplacementReview,discoveryResearchPending,runDiscoveryResearchTest,ownerAccessPending,runOwnerAccess,engineRepairPending,runEngineRepair,recipientRecoveryPending,runRecipientRecovery,enabled:true,pool,service,runCampaign,runRegeneration,runPendingRegenerations,refreshDirectory,editorialWritingReviewPending,runEditorialWritingReview,distributionPreflightPending,runDistributionPreflight,ownerInvitationPending,runOwnerInvitation,editorialStandardPending,runEditorialStandard};
 }catch(error){await pool.end?.();throw error;}
}
module.exports={resumePendingDiscovery,restoreOwnerReviewAccess,runOwnerInvitationOnce,mountV3PreparationReview,loadPublishedScans,refreshPublishedScans,enumeratePublishedScans,mergeCurrentPublishedScan,campaignIdFor,selectNextPublishedScan,runNextPublishedCampaign,runReleaseOnce,runIncompleteCampaignRecovery};

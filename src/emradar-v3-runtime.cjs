'use strict';
const {Pool}=require('pg');
const {createHash}=require('node:crypto');
const {readFileSync,readdirSync}=require('node:fs');
const path=require('node:path');
const {createV3IsolatedWiring}=require('./emradar-v3-wiring.cjs');

const ATTESTATION_DIR=path.join(__dirname,'../vendor/emradar-v3/verification');
const REVIEW_PATHS=new Set(['/review/access','/api/review/exchange','/api/review/view','/api/review/decision','/api/review/group','/api/review/revise','/api/review/discover','/api/review/release']);

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
 const liveUrl='https://emerging-markets-radar.onrender.com/data/discovery.json';
 const response=await fetcher(liveUrl,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/json','cache-control':'no-cache'}});
 if(!response.ok)throw Error('SCAN_HTTP_'+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>10*1024*1024)throw Error('SCAN_TOO_LARGE');
 const document=JSON.parse(bytes.toString('utf8'));
 if(document.publication_state!=='PUBLISHED'||!/^\d{4}-\d{2}-\d{2}$/.test(document.snapshot_date||''))throw Error('SCAN_NOT_PUBLISHED');
 return [{snapshotDate:document.snapshot_date,expectedSha256:createHash('sha256').update(bytes).digest('hex'),liveUrl,
 archiveUrl:'https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-'+document.snapshot_date+'.json'}];
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
 for(const candidate of published){
  const existing=await readCampaign(campaignIdFor(candidate));
  if(existing?.phase!=='PUBLICATION_REVIEW')return {...candidate,resume:Boolean(existing)};
 }
 return null;
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
async function runReleaseOnce({adapter,key,run}){
 const claimed=await adapter.compareAndSwap(key,null,{status:'STARTED',started_at:new Date().toISOString()});
 if(!claimed)return {status:'RELEASE_ALREADY_EXECUTED'};
 try{
  const result=await run();
  await adapter.compareAndSwap(key,1,{status:'COMPLETE',completed_at:new Date().toISOString(),result});
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
 if(!openai?.chat?.completions?.create||!openai?.images?.generate)throw Error('V3_OPENAI_PROVIDER_REQUIRED');
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
   pool,token:env.EMRADAR_V3_API_TOKEN,reviewOrigin:env.EMRADAR_V3_REVIEW_ORIGIN,env,createTransport
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
  let releaseApprovedEmail;
  const reviewServer=createReviewServer({workflow:service.workflow,runDiscovery:campaignId=>service.resumeIntelligentDiscovery(campaignId),releaseEmail:input=>releaseApprovedEmail(input)});
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
  const published=()=>refreshPublishedScans({fetcher});
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
   selected=selected??await choose();
   if(!selected)return {status:'NO_UNPROCESSED_SCAN',destination_count:0,editorial_count:0};
   const verified=await verify(selected);
   const destinations=await service.discover({scan:verified.scan,document:verified.document});
   return {status:'DISCOVERY_COMPLETE',snapshotDate:selected.snapshotDate,destination_count:destinations.length,editorial_count:destinations.filter(d=>d.id!=='x').length};
  };
  // Newest verified unprocessed scan; review invitation is issued only
  // after durable PUBLICATION_REVIEW. Never delivers to destinations.
  const runCampaign=async(snapshotDate)=>{
   // Historical runs require the source's paired release attestations and exact archive digest.
   // Never substitute the current live scan for a requested historical date.
   const selected=snapshotDate?await fetchHistoricalPublishedScan(snapshotDate,{fetcher}):(await published())[0];
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
     return {campaignId,snapshotDate:selected.snapshotDate,status:completion.complete?'PUBLICATION_REVIEW':'V3_PUBLICATION_REVIEW_INCOMPLETE',...completion,notification:review.status};
    }
    // Preparation owns evidence research and discovery, preserving their order
    // and resuming persisted destinations instead of repeating completed work.
    return {...await service.prepareAndNotify(selected),snapshotDate:selected.snapshotDate};
   }finally{
    await client.query('SELECT pg_advisory_unlock(hashtext($1))',[campaignId]);
    client.release();
   }
  };
  // Explicit owner-authenticated release of ONE approved email at a time.
  // No automatic distribution, no X publishing, and no retries of ambiguous sends.
  releaseApprovedEmail=async({campaignId,destinationId,sessionId,sessionSecret}={})=>{
   if([campaignId,destinationId,sessionId,sessionSecret].some(v=>typeof v!=='string'||!v))throw Error('V3_RELEASE_REQUEST_INVALID');
    await service.workflow.authenticate(campaignId,sessionId,sessionSecret);
    const state=(await service.store.adapter.read(campaignId))?.value;
    const entry=state?.assets?.[destinationId];
    const approval=state?.decisions?.[destinationId];
    if(state?.phase!=='PUBLICATION_REVIEW'||entry?.asset?.kind!=='EMAIL'||approval?.authority!=='OWNER'||approval?.decision!=='APPROVE'||approval.asset_sha256!==entry.fingerprint||state.deliveries?.[destinationId])
     throw Error('V3_RELEASE_NOT_APPROVED');
    await require('./emradar-v3-recipient.cjs').checkPersistedRecipient(pool,entry.asset,state);
    const claimed=await service.store.claimDelivery(campaignId,destinationId);
    const key=claimed.deliveries[destinationId].idempotency_key;
    try{
     const receipt=await integration.handle({operation:'approved-delivery',payload:{version:'EMRADAR_V3',kind:'APPROVED_DELIVERY',campaign_id:campaignId,destination_id:destinationId,asset:entry.asset,approval,idempotency_key:key}});
     await service.store.recordDelivery(campaignId,destinationId,'ACCEPTED',{provider_id:receipt.receipt_id,sent_folder:receipt.sent_folder,smtp_response:receipt.smtp_response});
     return {status:'ACCEPTED',campaignId,destinationId,receipt_id:receipt.receipt_id,sent_folder:receipt.sent_folder};
    }catch(error){
     await service.store.recordDelivery(campaignId,destinationId,'AMBIGUOUS',{reason:'TRANSPORT_OUTCOME_UNKNOWN'});
     throw Error('V3_DELIVERY_OUTCOME_AMBIGUOUS');
    }
  };
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
  const editorialWritingReviewPending=Boolean(editorialState && editorialState.editorial_rewrite?.request_id!==editorialRequest);
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
  // One-time recovery of the consumed October 10 private owner invitation.
  // The durable claim prevents duplicate emails across restarts/instances.
  if(env.EMRADAR_V3_PREPARATION_ENABLED==='true'){
   const campaignId='v3-2602ddf68a3ced8aeafb769fc928423f';
   const adapter=service.store.adapter;
   const prior=(await adapter.read(campaignId))?.value;
   const review=(await adapter.read('review:'+campaignId))?.value;
   if(!distributionPreflightPending&&!editorialWritingReviewPending&&prior?.phase==='PUBLICATION_REVIEW'&&review?.status==='CONSUMED'){
    const key='v3-owner-review-renewal:2026-10-16:'+campaignId;
    const claimed=await adapter.compareAndSwap(key,null,{status:'STARTED',started_at:new Date().toISOString()});
    if(claimed){
     try{await service.workflow.issue(campaignId);
      const saved=await adapter.read(key);
      await adapter.compareAndSwap(key,saved.version,{status:'COMPLETE',completed_at:new Date().toISOString()});
     }catch(error){console.error('V3_OWNER_REVIEW_RENEWAL_FAILED',error.message);}
    }
   }
  }
  return {enabled:true,pool,service,runCampaign,refreshDirectory,editorialWritingReviewPending,runEditorialWritingReview,distributionPreflightPending,runDistributionPreflight};
 }catch(error){await pool.end?.();throw error;}
}
module.exports={mountV3PreparationReview,loadPublishedScans,refreshPublishedScans,campaignIdFor,selectNextPublishedScan,runNextPublishedCampaign,runReleaseOnce,runIncompleteCampaignRecovery};

'use strict';
const {Pool}=require('pg');
const {createHash}=require('node:crypto');
const {readFileSync,readdirSync}=require('node:fs');
const path=require('node:path');
const {createV3IsolatedWiring}=require('./emradar-v3-wiring.cjs');

const ATTESTATION_DIR=path.join(__dirname,'../vendor/emradar-v3/verification');
const REVIEW_PATHS=new Set(['/review/access','/api/review/exchange','/api/review/view','/api/review/decision','/api/review/group','/api/review/revise']);

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
  const reviewServer=createReviewServer({workflow:service.workflow});
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
  const published=loadPublishedScans();
  const verify=async selected=>{
   const verified=await verifyPublishedScan({...selected,fetcher});
   return {...verified,document:normalizePublishedEvidence(verified.document)};
  };
  const choose=()=>selectNextPublishedScan({published,readCampaign:async id=>(await service.store.adapter.read(id))?.value});
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
  const runCampaign=async()=>{
   const adapter=service.store.adapter;
   const original=(await adapter.read('v3-release:2026-10-14-one-live-campaign'))?.value;
   if(original?.status==='COMPLETE' && original?.result?.campaignId){
    const drafts=(await adapter.read('v3-release:2026-10-14-editorial-drafts'))?.value;
    if(drafts?.status==='COMPLETE')return runReleaseOnce({adapter,key:'v3-release:2026-10-15-industry-publication-search',run:()=>service.resumeIntelligentDiscovery(original.result.campaignId)});
    return runReleaseOnce({adapter,key:'v3-release:2026-10-14-editorial-drafts',run:()=>service.resumeEditorialDrafts(original.result.campaignId)});
   }
   return runReleaseOnce({adapter,key:'v3-release:2026-10-14-one-live-campaign',run:()=>
    runNextPublishedCampaign({
     published,readCampaign:async id=>(await adapter.read(id))?.value,
     startCampaign:scan=>service.store.start(scan),verify,
     discover:({scan,document})=>service.discover({scan,document}),
     persistDestinations:(campaignId,destinations)=>service.store.select(campaignId,destinations),
     prepareAndNotify:selected=>service.prepareAndNotify(selected)
    })
   });
  };
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
    const result=await runCampaign();
    return res.status(200).json(result);
   }catch(error){
    return res.status(409).json({reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'V3_PREPARATION_FAILED'});
   }
  });
  return {enabled:true,pool,service,runCampaign,refreshDirectory};
 }catch(error){await pool.end?.();throw error;}
}
module.exports={mountV3PreparationReview,loadPublishedScans,campaignIdFor,selectNextPublishedScan,runNextPublishedCampaign,runReleaseOnce};

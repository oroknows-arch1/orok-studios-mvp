'use strict';
const {Pool}=require('pg');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {createV3IsolatedWiring}=require('./emradar-v3-wiring.cjs');

const SCAN_DATE='2026-10-13';
const SHA='49157d607f4f1a0db9437abe004fe81215afba653a5a416927786bbe0b8c59b8';
const ARCHIVE='https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-'+SCAN_DATE+'.json';
const ATTESTATION_DIR=path.join(__dirname,'../vendor/emradar-v3/verification');
const REVIEW_PATHS=new Set(['/review/access','/api/review/exchange','/api/review/view','/api/review/decision','/api/review/group','/api/review/revise']);

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
  const loadPublished=()=>({
   publicationRecord:JSON.parse(readFileSync(path.join(ATTESTATION_DIR,'publication-'+SCAN_DATE+'.json'),'utf8')),
   releaseAttestation:JSON.parse(readFileSync(path.join(ATTESTATION_DIR,'downstream-release-attestation-'+SCAN_DATE+'.json'),'utf8'))
  });
  const refreshDirectory=async()=>{
   if(env.EMRADAR_V3_AUTONOMOUS_DISCOVERY!=='true')throw Error('V3_AUTONOMOUS_DISCOVERY_DISABLED');
   const attestation=loadPublished();
   const verified=await verifyPublishedScan({snapshotDate:SCAN_DATE,expectedSha256:SHA,liveUrl:ARCHIVE,archiveUrl:ARCHIVE,...attestation,fetcher});
   const document=normalizePublishedEvidence(verified.document);
   const destinations=await service.discover({scan:verified.scan,document});
   return {status:'DISCOVERY_COMPLETE',destination_count:destinations.length,editorial_count:destinations.filter(d=>d.id!=='x').length};
  };
  // Fixed published-scan preparation; review invitation is issued only
  // after durable PUBLICATION_REVIEW. Never delivers to destinations.
  const runCampaign=async()=>{
    const publicationRecord=JSON.parse(readFileSync(path.join(ATTESTATION_DIR,'publication-'+SCAN_DATE+'.json'),'utf8'));
    const releaseAttestation=JSON.parse(readFileSync(path.join(ATTESTATION_DIR,'downstream-release-attestation-'+SCAN_DATE+'.json'),'utf8'));
    return service.prepareAndNotify({
     snapshotDate:SCAN_DATE,expectedSha256:SHA,liveUrl:ARCHIVE,archiveUrl:ARCHIVE,
     publicationRecord,releaseAttestation
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
module.exports={mountV3PreparationReview};

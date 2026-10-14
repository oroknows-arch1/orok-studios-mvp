'use strict';
const {Pool}=require('pg');
const {createV3IsolatedWiring}=require('./emradar-v3-wiring.cjs');

// Opt-in runtime. Only owner-notification is mounted: no approved-delivery
// HTTP route exists in this preparation-only activation.
async function mountV3PreparationReview({app,env=process.env,createPool=options=>new Pool(options),createTransport}={}){
 if(env.EMRADAR_V3_PREPARATION_ENABLED!=='true')return {enabled:false};
 if(typeof app?.post!=='function')throw Error('V3_APP_REQUIRED');
 if(!env.EMRADAR_V3_DATABASE_URL||!env.EMRADAR_V3_API_TOKEN||!env.EMRADAR_V3_REVIEW_ORIGIN)
  throw Error('V3_ACTIVATION_CONFIG_REQUIRED');
 const pool=createPool({connectionString:env.EMRADAR_V3_DATABASE_URL});
 try{
  const integration=createV3IsolatedWiring({
   pool,token:env.EMRADAR_V3_API_TOKEN,reviewOrigin:env.EMRADAR_V3_REVIEW_ORIGIN,env,createTransport
  });
  await integration.initialize();
  app.post('/emradar/v3/owner-notification',(req,res)=>{
   req.params={...req.params,operation:'owner-notification'};
   return integration.route(req,res);
  });
  return {enabled:true,pool};
 }catch(error){await pool.end?.();throw error;}
}
module.exports={mountV3PreparationReview};

'use strict';
// Run inside the target Render environment. Never prints tokens or raw errors.
const {Pool}=require('pg');
const {createV3X}=require('../src/emradar-v3-x.cjs');
async function main(){
 const campaignId=process.argv[2];
 if(!/^v3-[a-f0-9]{32}$/.test(campaignId||''))throw Error('V3_X_CAMPAIGN_REQUIRED');
 const pool=new Pool({connectionString:process.env.EMRADAR_V3_DATABASE_URL||process.env.DATABASE_URL});
 const x=createV3X({env:process.env,pool});
 try{
  const {rows}=await pool.query('SELECT payload FROM v3_campaign_state WHERE campaign_id=$1',[campaignId]);
  const state=rows[0]?.payload,entry=state?.assets?.x;
  if(!entry||entry.asset.kind!=='X')throw Error('V3_X_ASSET_REQUIRED');
  const identity=await x.verifyIdentity({allowRefresh:process.argv.includes('--allow-refresh-after-cutover')});
  const result=await x.inspect({asset:entry.asset,scan:state.scan});
  console.log(JSON.stringify({status:'VERIFIED_READ_ONLY',campaign_id:campaignId,...identity,...result}));
 }finally{await x.close();await pool.end();}
}
main().catch(error=>{console.error(JSON.stringify({status:'BLOCKED',reason:/^V3_X_[A-Z0-9_]+$/.test(error.message)?error.message:'V3_X_VERIFICATION_FAILED'}));process.exitCode=1;});

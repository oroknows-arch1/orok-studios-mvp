'use strict';
const {createV3PreparedIntegration}=require('./emradar-v3-integration.cjs');
const {createV3X}=require('./emradar-v3-x.cjs');
const {createV3Smtp}=require('./emradar-v3-smtp.cjs');

// Explicit V3-only assembly. No database migration, route mount or SMTP
// connection occurs until the owner separately authorizes activation.
function createV3IsolatedWiring({pool,token,reviewOrigin,env,createTransport,fetcher,xAuth}={}){
 const smtp=createV3Smtp({env,createTransport});
 const x=createV3X({env,pool,fetcher,auth:xAuth});
 const prepareApprovedX=async payload=>{
  const {rows}=await pool.query('SELECT payload FROM v3_campaign_state WHERE campaign_id=$1',[payload.campaign_id]);
  return x.prepare({asset:payload.asset,scan:rows[0]?.payload?.scan});
 };
 const integration=createV3PreparedIntegration({
  pool,token,reviewOrigin,
  sendOwnerReview:smtp.sendOwnerReview,
  sendApprovedEmail:smtp.sendApprovedEmail,prepareApprovedX
 });
 return {...integration,initialize:async()=>{await integration.initialize();await x.auth.initialize();},xThread:x,xAuth:x.auth,prepareApprovedX,assertXEnabled:x.assertEnabled,verifyXIdentity:x.verifyIdentity,verifyMailTransport:smtp.verifyTransport,inspectOwnerInvitation:smtp.inspectOwnerInvitation,inspectOwnerMailbox:smtp.inspectOwnerMailbox};
}
module.exports={createV3IsolatedWiring};

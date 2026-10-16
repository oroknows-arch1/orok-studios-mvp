'use strict';
const {createV3PreparedIntegration}=require('./emradar-v3-integration.cjs');
const {createV3Smtp}=require('./emradar-v3-smtp.cjs');

// Explicit V3-only assembly. No database migration, route mount or SMTP
// connection occurs until the owner separately authorizes activation.
function createV3IsolatedWiring({pool,token,reviewOrigin,env,createTransport}={}){
 const smtp=createV3Smtp({env,createTransport});
 const integration=createV3PreparedIntegration({
  pool,token,reviewOrigin,
  sendOwnerReview:smtp.sendOwnerReview,
  sendApprovedEmail:smtp.sendApprovedEmail
 });
 return {...integration,verifyMailTransport:smtp.verifyTransport,inspectOwnerInvitation:smtp.inspectOwnerInvitation};
}
module.exports={createV3IsolatedWiring};

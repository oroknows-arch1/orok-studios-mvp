'use strict';
const {V3Reservations}=require('./emradar-v3-reservations.cjs');
const {createV3ApprovalVerifier}=require('./emradar-v3-approval-verifier.cjs');
const {createV3Boundary}=require('./emradar-v3-boundary.cjs');
const {createV3Route}=require('./emradar-v3-route.cjs');

// Explicit dependency injection: no connection, migration, mount or email at
// module import. Only owner-authorized server wiring can activate this factory.
function createV3PreparedIntegration({pool,token,verifyNotification,sendOwnerReview,sendApprovedEmail}={}){
 if(typeof verifyNotification!=='function'||typeof sendOwnerReview!=='function'||typeof sendApprovedEmail!=='function')throw Error('V3_INTEGRATION_DEPENDENCIES_REQUIRED');
 const reservations=new V3Reservations(pool);
 const boundary=createV3Boundary({
  verifyNotification,
  verifyApprovedDelivery:createV3ApprovalVerifier({pool}),
  sendOwnerReview,sendApprovedEmail,
  notificationReservation:reservations.owner,
  sendReservation:reservations.send
 });
 return {route:createV3Route({handle:boundary,token}),initialize:()=>reservations.initialize()};
}
module.exports={createV3PreparedIntegration};

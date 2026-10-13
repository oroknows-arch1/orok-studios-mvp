'use strict';
const crypto=require('node:crypto');

// Inert until explicitly mounted by the owner. Does not load SMTP, credentials
// or the legacy EMRADAR relay. A separate V3 token is required at mount time.
function createV3Route({handle,token}={}){
 if(typeof handle!=='function'||typeof token!=='string'||token.length<32)throw Error('V3_ROUTE_CONFIGURATION_REQUIRED');
 const expected=Buffer.from('Bearer '+token);
 return async function(req,res){
  const actual=Buffer.from(typeof req.headers?.authorization==='string'?req.headers.authorization:'');
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return res.status(403).json({reason:'V3_API_AUTH_REQUIRED'});
  const operation=req.params?.operation;
  if(!['owner-notification','approved-delivery'].includes(operation))return res.status(404).json({reason:'V3_UNKNOWN_OPERATION'});
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({reason:'V3_REQUEST_INVALID'});
  try{return res.status(200).json(await handle({operation,payload:req.body}));}
  catch(error){
   const code=typeof error?.message==='string'&&/^V3_[A-Z0-9_]+$/.test(error.message)?error.message:'V3_OPERATION_UNCONFIRMED';
   return res.status(409).json({reason:code});
  }
 };
}
module.exports={createV3Route};

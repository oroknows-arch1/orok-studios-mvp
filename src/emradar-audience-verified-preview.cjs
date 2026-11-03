'use strict';
const {prepareVisualReview}=require('./emradar-audience-visual-review.cjs');
function createVerifiedVisualReview({verifyMedia}={}){
 if(typeof verifyMedia!=='function')throw Error('VISUAL_MEDIA_VERIFIER_REQUIRED');
 return async function prepareVerifiedVisualReview(input){
  const preview=prepareVisualReview(input);
  const problems=[...preview.problems],media_verification=[];
  for(const segment of preview.segments){
   if(segment.media==null)continue;
   let result;
   try{result=await verifyMedia(segment.media)}catch{result={verified:false,reason:'MEDIA_VERIFICATION_FAILED'}}
   media_verification.push({sequence:segment.sequence,...result});
   if(result?.verified!==true||result.sha256!==segment.media.sha256)problems.push({sequence:segment.sequence,reason:result?.reason||'MEDIA_NOT_VERIFIED'});
  }
  const ready=problems.length===0;
  return {...preview,problems,media_verification,ready_for_authenticated_approval:ready,
   html:preview.html+(ready?'':'<p role="alert">Approval unavailable: image-byte verification incomplete or failed.</p>')};
 };
}
module.exports={createVerifiedVisualReview};

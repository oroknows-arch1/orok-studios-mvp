'use strict';
// Composition for an independently invoked audience worker/review controller.
// Nothing imports this from V3. No scheduler, credential or external call at import.
async function createIndependentAudience({audiencePool,readSource,readOwnerAccess,authenticateOwner,loadPublishedBytes,x,writePosts,pilot,researchOptions={},publishEnabled=false}){
 if(typeof authenticateOwner!=='function')throw Error('AUDIENCE_OWNER_AUTHENTICATION_REQUIRED');
 const {CampaignStore}=await import('../vendor/emradar-v3/src/state.js');
 const {AudienceAdapter}=require('./emradar-audience-isolated-store.cjs');
 const {ThreadStore}=require('./emradar-x-thread-store.cjs');
 const adapter=new AudienceAdapter({pool:audiencePool,readSource,readOwnerAccess});await adapter.initialize();
 const store=new CampaignStore(adapter),threadStore=new ThreadStore(audiencePool);await threadStore.initialize();await threadStore.initializeOriginals();
 const review=require('./emradar-audience-v3-review.cjs').createV3AudienceReview({store,loadPublishedBytes,writePosts});
 review.setPublicationRowsReader(id=>threadStore.list(id));
 const publish=require('./emradar-audience-v3-publication.cjs').createV3ThreadPublication({campaignStore:store,threadStore,review,x,enabled:publishEnabled});
 const research=pilot?require('./emradar-grok-full-scan.cjs').createFullScanResearch({...researchOptions,store,pilot,loadPublishedBytes,loadPublicationRows:id=>threadStore.list(id)}):null;
 async function owner(id,session,secret,action){await authenticateOwner(id,session,secret);return action();}
 return {
  prepare:async id=>{await adapter.importSource(id);return review.prepare(id)},
  view:(id,session,secret)=>owner(id,session,secret,async()=>({campaignId:id,phase:'PUBLICATION_REVIEW',entries:[],xThread:await review.view(id)})),
  present:(id,session,secret,input)=>owner(id,session,secret,()=>review.present(id,session,input)),
  decide:(id,session,secret,decision,sha)=>owner(id,session,secret,()=>review.decide(id,session,decision,sha)),
  revise:(id,session,secret,sha,changes)=>owner(id,session,secret,()=>review.revise(id,sha,changes)),
  run:async id=>{const result=await publish(id);if(result.status==='COMPLETE'&&research)await research(id);return result;}
 };
}
module.exports={createIndependentAudience};

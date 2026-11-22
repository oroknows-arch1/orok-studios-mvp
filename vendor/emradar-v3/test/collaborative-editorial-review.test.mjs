import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCollaborativeEditorial} from '../src/collaborative-editorial-review.js';

function fixture(){
 const campaignId='v3-test-collaboration';
 let campaign={phase:'PUBLICATION_REVIEW',assets:{
  a:{fingerprint:'sha-a',asset:{destination_id:'a',body:'Proposed project; financing unresolved'}},
  b:{fingerprint:'sha-b',asset:{destination_id:'b',body:'Verified project'}},
  c:{fingerprint:'sha-c',asset:{destination_id:'c',body:'Historical sent'}},
 },decisions:{},deliveries:{c:{receipt:'sent'}},editorial_preparation:{outcomes:{}}};
 const map=new Map([[campaignId,{version:1,value:campaign}]]);
 const adapter={
  async read(key){return map.get(key)??null;},
  async compareAndSwap(key,version,value){
   const prior=map.get(key);
   if(version===null&&prior)return false;
   if(version!==null&&prior?.version!==version)return false;
   map.set(key,{version:(prior?.version??0)+1,value});return true;
  }
 };
 return {campaignId,adapter,map,getCampaign:()=>campaign,putCampaign:c=>{
  campaign=c;map.set(campaignId,{version:(map.get(campaignId)?.version??0)+1,value:c});
 }};
}
function googleFixture(ctx,{revise=true,unavailable=false}={}){
 const requests=[];
 const reviewGoogle=async(state)=>{
  requests.push(state);
  if(unavailable)return {status:'AUDITOR_UNAVAILABLE'};
  const round=requests.length;
  const key='audit-'+round;
  const outcomes=round===1?[
   {id:'a',fingerprint:'sha-a',verdict:'CORRECT',reason:'Clarify financing',correction:'Financing unconfirmed',sourceUrls:[]},
   {id:'b',fingerprint:'sha-b',verdict:'READY',reason:'Supported',correction:'',sourceUrls:[]},
   {id:'c',fingerprint:'sha-c',verdict:'DROP',reason:'Incorrect',correction:'',sourceUrls:[]},
  ]:[{id:'a',fingerprint:'sha-a2',verdict:'READY',reason:'Clearly qualified',correction:'',sourceUrls:[]}];
  ctx.map.set(key,{version:1,value:{status:'ADVISORY',outcomes}});
  return {status:'ADVISORY',recordKey:key};
 };
 const revisions=[];
 const reviewV3=async(id,opts)=>{
  revisions.push(opts);
  if(revise){
   const c=structuredClone(ctx.getCampaign());
   c.assets.a.fingerprint='sha-a2';
   c.assets.a.asset.body='Proposed project; financing remains unconfirmed, and the article will investigate what comes next';
   c.editorial_preparation.outcomes.a={status:'CORRECTED_READY'};
   ctx.putCampaign(c);
  }
 };
 return {requests,revisions,reviewGoogle,reviewV3};
}
test('one Google campaign audit, targeted V3 source correction and one final audit',async()=>{
 const ctx=fixture(),g=googleFixture(ctx);
 const result=await reconcileCollaborativeEditorial({adapter:ctx.adapter,campaignId:ctx.campaignId,...g});
 assert.equal(result.status,'COMPLETE');
 assert.equal(result.corrected,1);
 assert.equal(result.google_objections,1);
 assert.equal(g.requests.length,2);
 assert.equal(g.revisions.length,1);
 assert.equal(g.revisions[0].forceRecheck,true);
 assert.equal(g.revisions[0].googleFeedback.a.verdict,'CORRECT');
 assert.equal(ctx.getCampaign().assets.c.fingerprint,'sha-c');
 assert.equal(ctx.getCampaign().deliveries.c.receipt,'sent');
});
test('no revised wording means no second Google call and no automatic DROP',async()=>{
 const ctx=fixture(),g=googleFixture(ctx,{revise:false});
 const result=await reconcileCollaborativeEditorial({adapter:ctx.adapter,campaignId:ctx.campaignId,...g});
 assert.equal(result.reassessed,1);
 assert.equal(g.requests.length,1);
 assert.deepEqual(ctx.getCampaign().decisions,{});
});
test('Google failure never edits or blocks historical campaign',async()=>{
 const ctx=fixture(),g=googleFixture(ctx,{unavailable:true});
 const result=await reconcileCollaborativeEditorial({adapter:ctx.adapter,campaignId:ctx.campaignId,...g});
 assert.equal(result.status,'GOOGLE_UNAVAILABLE');
 assert.equal(g.revisions.length,0);
});
test('repeated exact audit does not repeat source investigation',async()=>{
 const ctx=fixture(),g=googleFixture(ctx,{revise:false});
 const first=await reconcileCollaborativeEditorial({adapter:ctx.adapter,campaignId:ctx.campaignId,...g});
 assert.equal(first.status,'COMPLETE');
 const second=await reconcileCollaborativeEditorial({adapter:ctx.adapter,campaignId:ctx.campaignId,
  reviewGoogle:()=>({status:'ADVISORY',recordKey:first.first_audit}),reviewV3:g.reviewV3});
 assert.equal(second.status,'ALREADY_RECONCILED');
 assert.equal(g.revisions.length,1);
});

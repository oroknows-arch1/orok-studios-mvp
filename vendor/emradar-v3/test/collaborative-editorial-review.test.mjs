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

test('unchanged recipient draft can receive a stricter V3 outcome after Google challenge',async()=>{
 const {CampaignStore}=await import('../src/state.js');
 const {assetFingerprint}=await import('../src/contracts.js');
 const {proposalBinding}=await import('../src/proposal-verification.js');
 const id='v3-source-recheck',destination={id:'a',name:'Publication A',contact:{email:'editor@example.org'},contact_verified:true,delivery_eligible:true};
 const asset={campaign_id:id,destination_id:'a',kind:'EMAIL',subject:'A development',body:'A proposed investment remains unresolved.',to:'editor@example.org',evidence_ids:['one'],review_status:'READY',contact_status:'VERIFIED'};
 const evidence=[{id:'one',fact:'Project is proposed',verified:true,source_url:'https://example.org/source'}];
 const binding=proposalBinding({asset,destination,evidence});
 const old={...binding,status:'READY_VERIFIED',reason:'Previously accepted'};
 const original={phase:'PUBLICATION_REVIEW',id,assets:{a:{asset,fingerprint:assetFingerprint(asset)}},
  destinations:[destination],preparation_input:{document:{evidence}},editorial_preparation:{outcomes:{a:old}},
  decisions:{},deliveries:{},events:[],email_groups:{},group_approvals:{}};
 const rows=new Map([[id,{version:1,value:original}]]);
 const adapter={
  async read(key){return rows.get(key)??null},
  async compareAndSwap(key,version,value){
   const prev=rows.get(key);if(version===null?Boolean(prev):prev?.version!==version)return false;
   rows.set(key,{version:(prev?.version??0)+1,value});return true;
  }
 };
 const store=new CampaignStore(adapter);
 await store.applyEditorialPreparation(id,[{id:'a',fingerprint:assetFingerprint(asset),
  inputBinding:binding,asset,forceOutcome:true,
  record:{...binding,status:'INVESTIGATION_REQUIRED',reason:'Original passage does not support the amount',claims:[],sources:[]}}]);
 const after=(await adapter.read(id)).value;
 assert.equal(after.assets.a.fingerprint,assetFingerprint(asset));
 assert.equal(after.editorial_preparation.outcomes.a.status,'INVESTIGATION_REQUIRED');
 assert.equal(after.editorial_preparation.history.length,1);
 assert.deepEqual(after.decisions,{});
});

test('V3 checks a supported new draft in one model call rather than speculative pre-correction',async()=>{
 const {prepareEditorialReview}=await import('../src/editorial-preparation.js');
 const {CampaignStore}=await import('../src/state.js');
 const {assetFingerprint}=await import('../src/contracts.js');
 const id='v3-one-check',url='https://example.org/sources/test';
 const passage='The board announced the project remains proposed and subject to financing approval.';
 const destination={id:'a',name:'Publication A',category:'publication',contact:{email:'editor@example.org'},contact_verified:true,delivery_eligible:true};
 const asset={campaign_id:id,destination_id:'a',kind:'EMAIL',subject:'The proposed project and its financing question',body:'The board has proposed a project. The financing approval has not been confirmed.',to:'editor@example.org',evidence_ids:['one'],review_status:'READY',contact_status:'VERIFIED'};
 const evidence=[{id:'one',fact:passage,verified:true,source_url:url}];
 const original={id,phase:'PUBLICATION_REVIEW',assets:{a:{asset,fingerprint:assetFingerprint(asset)}},
  destinations:[destination],preparation_input:{document:{evidence}},editorial_preparation:{outcomes:{}},
  decisions:{},deliveries:{},events:[],email_groups:{},group_approvals:{}};
 const rows=new Map([[id,{version:1,value:original}]]);
 const adapter={
  async read(k){return rows.get(k)??null},
  async compareAndSwap(k,version,value){
   const prior=rows.get(k);if(version===null?Boolean(prior):prior?.version!==version)return false;
   rows.set(k,{version:(prior?.version??0)+1,value});return true;
  }
 };
 const store=new CampaignStore(adapter);
 const stages=[];
 const assess=async({stage})=>{stages.push(stage);return {
  status:'VERIFIED',deliverable:true,fit:{a:true},
  claims:[{material:true,status:'VERIFIED',text:'The project is proposed',passages:[{url,quote:passage}]}],
  contradictions:[],revision:null,explanation:'Article offers a legitimate unresolved question'
 }};
 const outcome=await prepareEditorialReview({store,campaignId:id,readSource:async()=>({url,text:passage,page_sha256:'sha-page'}),
  assess,renderRevision:async asset=>asset});
 assert.deepEqual(stages,['CHECK']);
 assert.equal((await adapter.read(id)).value.editorial_preparation.outcomes.a.status,'READY_VERIFIED');
 assert.ok(['READY_VERIFIED','INVESTIGATION_REQUIRED'].includes(outcome.a)); // separate recipient-readiness gate
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignPreparation} from '../vendor/emradar-v3/src/preparation.js';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';

const campaignId='v3-test';
const evidence=[{id:'e1',verified:true,fact:'Verified fact'}];
const destinations=[
 {id:'writer-failure',name:'Writer failure',evidence:{ids:['e1']},contact_verified:true},
 {id:'missing-contact',name:'Missing contact',evidence:{ids:['e1']},contact_verified:false},
 {id:'x',name:'X',evidence:{ids:['e1']},contact_verified:true}
];

test('writer, missing-contact and oversized-X failures all reach owner-visible review',async()=>{
 let state={phase:'DESTINATIONS_SELECTED',destinations,assets:{},decisions:{},deliveries:{},events:[]};
 const store={
  start:async()=>campaignId,select:async()=>{},adapter:{read:async()=>({value:state})},
  prepare:async(_id,assets,warnings)=>{state={...state,phase:'PUBLICATION_REVIEW',assets:Object.fromEntries(assets.map(asset=>[asset.destination_id,{asset}])),preparation_warnings:warnings};}
 };
 const preparation=new CampaignPreparation({store,discover:async()=>destinations,write:async({destination})=>{
  if(destination.id==='writer-failure')throw Error('WRITER_FAILED');
  if(destination.id==='missing-contact')throw Error('V3_VERIFIED_RECIPIENT_REQUIRED');
  return {campaign_id:campaignId,destination_id:'x',kind:'X',subject:'Verified',body:'Verified fact',evidence_ids:['e1']};
 },renderVisual:async()=>{throw Error('V3_X_GRAPHIC_LAYOUT_OVERFLOW');}});
 const result=await preparation.prepare({scan:{},document:{evidence}});
 assert.equal(result.status,'PUBLICATION_REVIEW');assert.equal(result.assets,3);assert.equal(result.warnings,3);
 assert.deepEqual(Object.keys(state.assets).sort(),['missing-contact','writer-failure','x']);
 for(const {asset} of Object.values(state.assets))assert.equal(asset.review_status,'NEEDS_REVISION');
 assert.deepEqual(state.preparation_warnings.map(item=>item.code).sort(),['V3_VERIFIED_RECIPIENT_REQUIRED','V3_X_GRAPHIC_LAYOUT_OVERFLOW','WRITER_FAILED']);
});

test('incomplete items can be rejected, excluded or queued for regeneration but never approved or delivered',async()=>{
 let version=1,value={phase:'PUBLICATION_REVIEW',destinations:[destinations[0]],assets:{'writer-failure':{asset:{campaign_id:campaignId,destination_id:'writer-failure',kind:'EMAIL',body:'Incomplete',review_status:'NEEDS_REVISION'},fingerprint:'fingerprint'}},decisions:{},deliveries:{},events:[]};
 const adapter={read:async()=>({version,value:structuredClone(value)}),compareAndSwap:async(_id,expected,next)=>{if(expected!==version)return false;value=structuredClone(next);version++;return true;}};
 const store=new CampaignStore(adapter);
 await assert.rejects(store.decide(campaignId,'writer-failure','APPROVE','fingerprint'),/INCOMPLETE_ASSET_CANNOT_BE_APPROVED/);
 await store.decide(campaignId,'writer-failure','REGENERATE','fingerprint');assert.equal(value.review_actions['writer-failure'].action,'REGENERATE');
 await store.decide(campaignId,'writer-failure','EXCLUDE','fingerprint');assert.equal(value.decisions['writer-failure'].decision,'EXCLUDE');
 await assert.rejects(store.claimDelivery(campaignId,'writer-failure'),/INCOMPLETE_ASSET_NOT_SENDABLE/);
});

test('rejection feedback is revision-bound, missing feedback waits, and a later owner approval cancels pending regeneration',async()=>{
 let version=1,value={phase:'PUBLICATION_REVIEW',destinations:[destinations[0]],assets:{'writer-failure':{asset:{campaign_id:campaignId,destination_id:'writer-failure',kind:'EMAIL',subject:'A researched angle',body:'Ready content',review_status:'READY'},fingerprint:'fingerprint'}},decisions:{},deliveries:{},events:[]};
 const adapter={read:async()=>({version,value:structuredClone(value)}),compareAndSwap:async(_id,expected,next)=>{if(expected!==version)return false;value=structuredClone(next);version++;return true;}};
 const store=new CampaignStore(adapter);
 await store.decide(campaignId,'writer-failure','REJECT','fingerprint','');
 assert.equal(value.decisions['writer-failure'].decision,'REJECT');assert.equal(value.decisions['writer-failure'].feedback_required,true);
 assert.equal(value.review_actions['writer-failure'].status,'NEEDS_FEEDBACK');assert.equal(value.review_feedback[0].asset_sha256,'fingerprint');
 await store.decide(campaignId,'writer-failure','REGENERATE','fingerprint','Keep the same verified finding and make the opening more publication-specific.');
 const request=value.review_actions['writer-failure'];assert.equal(request.status,'PENDING');assert(request.request_id);assert.equal(value.decisions['writer-failure'].decision,'REJECT');
 assert.equal(value.review_feedback.length,2);assert.equal(value.review_feedback[1].asset_sha256,'fingerprint');
 await store.decide(campaignId,'writer-failure','APPROVE','fingerprint');
 assert.equal(value.decisions['writer-failure'].decision,'APPROVE');assert.equal(value.review_actions['writer-failure'].status,'CANCELLED');
 assert.deepEqual(value.deliveries,{});
});

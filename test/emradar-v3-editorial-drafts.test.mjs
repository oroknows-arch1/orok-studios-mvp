import test from 'node:test';
import assert from 'node:assert/strict';
import verified from './fixtures/v3-verified-recipient.cjs';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {selectPersistedDraftDestinations,assessPublicationReview} from '../vendor/emradar-v3/src/preparation-review-service.js';
const evidence=[{id:'e1',verified:true,fact:'Verified fact',source_url:'https://source.example/fact'}];
const email=(d)=>({campaign_id:'campaign',destination_id:d.id,kind:'EMAIL',subject:'Draft',body:'Body',from:'sean@emradar.net',to:d.contact.email,contact_status:'VERIFIED',delivery_eligible:true,evidence_ids:['e1']});
test('missing recipients and source institutions never become draft destinations',()=>{
 const bad={...verified(),contact_verified:false,contact:null};
 assert.deepEqual(selectPersistedDraftDestinations({document:{evidence},candidates:[bad,{id:'source'}]}),[]);
});
test('persisted exact public proof is required and evidence links survive selection',()=>{
 const d=verified();const selected=selectPersistedDraftDestinations({document:{evidence},candidates:[d,{...d,id:'duplicate'}]});
 assert.equal(selected.length,1);assert.deepEqual(selected[0].evidence.ids,['e1']);assert.equal(selected[0].contact.source_url,d.contact.source_url);
});
test('review extension validates recipients before writes and preserves X and decisions',async()=>{
 let value={phase:'PUBLICATION_REVIEW',destinations:[{id:'x'}],assets:{x:{fingerprint:'keep',asset:{kind:'X',body:'X'}}},decisions:{x:{decision:'APPROVE'}},deliveries:{},events:[]},version=1;
 const store=new CampaignStore({read:async()=>({version,value:structuredClone(value)}),compareAndSwap:async(_id,v,next)=>{if(v!==version)return false;version++;value=next;return true;}});
 const d=verified();await assert.rejects(store.extendReview('campaign',[{...d,contact:null}],[email(d)]),/V3_VERIFIED_RECIPIENT_REQUIRED/);
 await store.extendReview('campaign',[d],[email(d)]);assert.equal(value.assets.x.fingerprint,'keep');assert.equal(value.decisions.x.decision,'APPROVE');
 assert.deepEqual(value.deliveries,{});await assert.rejects(store.decide('campaign','journal','APPROVE','wrong'),/INVALID_DECISION/);
});
test('PUBLICATION_REVIEW completion requires valid addressed emails and saved X graphic',()=>{
 const d=verified(),asset=email(d),state={phase:'PUBLICATION_REVIEW',preparation_input:{document:{evidence}},destinations:[d,{id:'x'}],assets:{journal:{asset},x:{asset:{kind:'X',destination_id:'x',body:'X',visual_url:'saved-image'}}}};
 assert.equal(assessPublicationReview({state,candidates:[d]}).complete,true);
 state.assets.journal.asset.to='invented@journal.example';assert.equal(assessPublicationReview({state,candidates:[d]}).complete,true);assert.equal(assessPublicationReview({state,candidates:[d]}).delivery_ready,false);
 state.assets.journal.asset=asset;delete state.assets.x;assert.equal(assessPublicationReview({state,candidates:[d]}).complete,false);
});
test('unresolved contact research cannot block a new verified proposal at fifteen publication records',()=>{
 const existingDestinations=Array.from({length:15},(_,i)=>({id:'existing-'+i,contact_verified:i<7}));
 const selected=selectPersistedDraftDestinations({document:{evidence},candidates:[verified('new-journal')],existingDestinations,existingIds:existingDestinations.map(d=>d.id)});
 assert.equal(selected.length,1);assert.equal(selected[0].delivery_eligible,true);
 const full=Array.from({length:15},(_,i)=>({id:'ready-'+i,contact_verified:true}));
 assert.equal(selectPersistedDraftDestinations({document:{evidence},candidates:[verified('new-journal')],existingDestinations:full,existingIds:full.map(d=>d.id)}).length,0);
});

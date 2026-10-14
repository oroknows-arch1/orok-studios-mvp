import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {assertSendable,sha256} from '../vendor/emradar-v3/src/contracts.js';
import {assessPublicationReview,selectPersistedDraftDestinations} from '../vendor/emradar-v3/src/preparation-review-service.js';

const evidence=[{id:'e1',verified:true,fact:'Verified fact',source_url:'https://source.example/fact'}];
const scanDigest=sha256(JSON.stringify(evidence.map(item=>[item.id,item.fact,item.source_url])));

test('reuses persisted evidence-linked publication as a clearly unverified draft destination',()=>{
 const selected=selectPersistedDraftDestinations({document:{evidence},existingIds:['x'],candidates:[{id:'journal',name:'Journal',category:'news',destination_class:'EDITORIAL_PUBLICATION',active:true,contact_verified:false,editorial_fit_verified:true,contact:{email:null},verification:{evidence_ids:['e1'],scan_evidence_digest:scanDigest}}]});
 assert.deepEqual(selected,[{id:'journal',name:'Journal',category:'news',destination_class:'EDITORIAL_PUBLICATION',relationship:undefined,contact:null,evidence:{ids:['e1']},contact_verified:false,editorial_fit_verified:true,delivery_eligible:false,contact_status:'UNVERIFIED',draft_only:true}]);
});

test('does not turn a legacy source institution into an editorial draft destination',()=>{
 const selected=selectPersistedDraftDestinations({document:{evidence},existingIds:['x'],candidates:[{id:'source',name:'Source',category:'research',active:true,verification:{evidence_ids:['e1'],scan_evidence_digest:scanDigest}}]});
 assert.deepEqual(selected,[]);
});

test('adds draft to existing X review without changing X, decisions or delivery state',async()=>{
 let value={id:'campaign',phase:'PUBLICATION_REVIEW',destinations:[{id:'x',contact_verified:true,evidence:{ids:['e1']}}],assets:{x:{asset:{campaign_id:'campaign',destination_id:'x',kind:'X',body:'x',evidence_ids:['e1']},fingerprint:'kept'}},decisions:{x:{decision:'APPROVE'}},deliveries:{},events:[]};
 let version=1;
 const adapter={read:async()=>({version,value}),compareAndSwap:async(_id,expected,next)=>{if(expected!==version)return false;version++;value=next;return true;}};
 const store=new CampaignStore(adapter);
 const destination={id:'journal',name:'Journal',category:'news',contact:null,evidence:{ids:['e1']},contact_verified:false,editorial_fit_verified:false,delivery_eligible:false,contact_status:'UNVERIFIED',draft_only:true};
 const asset={campaign_id:'campaign',destination_id:'journal',kind:'EMAIL',subject:'Draft',body:'Body',from:'sean@emradar.net',to:null,contact_status:'UNVERIFIED',delivery_eligible:false,evidence_ids:['e1']};
 await store.extendReview('campaign',[destination],[asset]);
 assert.equal(value.phase,'PUBLICATION_REVIEW');
 assert.equal(value.assets.x.fingerprint,'kept');
 assert.equal(value.decisions.x.decision,'APPROVE');
 assert.equal(value.assets.journal.asset.contact_status,'UNVERIFIED');
 assert.throws(()=>assertSendable({asset,approval:{}}),/VERIFIED_DELIVERY_DETAILS_REQUIRED/);
});

test('persisted completion requires every verified publication email and X graphic',()=>{
 const publication=id=>({id,destination_class:'EDITORIAL_PUBLICATION',active:true,editorial_fit_verified:true,verification:{status:'VERIFIED',evidence_ids:['e1'],scan_evidence_digest:scanDigest}});
 const state={phase:'PUBLICATION_REVIEW',preparation_input:{document:{evidence}},destinations:[{id:'x'},{id:'one'}],assets:{x:{asset:{destination_id:'x',kind:'X',body:'text',visual_url:'data:image/png;base64,AA'}},one:{asset:{destination_id:'one',kind:'EMAIL',body:'email'}}}};
 assert.deepEqual(assessPublicationReview({state,candidates:[publication('one'),publication('two')]}),{complete:false,verified_publications:2,editorial_emails:1,x_ready:true,missing_destination_ids:['two']});
 state.destinations.push({id:'two'});state.assets.two={asset:{destination_id:'two',kind:'EMAIL',body:'email'}};
 assert.deepEqual(assessPublicationReview({state,candidates:[publication('one'),publication('two')]}),{complete:true,verified_publications:2,editorial_emails:2,x_ready:true,missing_destination_ids:[]});
});

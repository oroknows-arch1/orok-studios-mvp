import test from 'node:test';
import assert from 'node:assert/strict';
import verified from './fixtures/v3-verified-recipient.cjs';
import policy from '../src/emradar-v3-recipient.cjs';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';
import {assetFingerprint} from '../vendor/emradar-v3/src/contracts.js';

function fixture(){
 const destination=verified('epoch');
 destination.name='Epoch AI';destination.website='https://epoch.ai';destination.verification.publication_proof_url='https://epoch.ai/about';destination.contact={...destination.contact,email:'donate@epoch.ai',purpose:'general',source_url:'https://epoch.ai/about',published_excerpt:'Donate. Please contact us at donate@epoch.ai for donation details.',page_sha256:'a'.repeat(64)};
 const asset={campaign_id:'campaign',destination_id:'epoch',kind:'EMAIL',to:'donate@epoch.ai',subject:'Existing subject',body:'Existing body\nRegards, Sean',from:'sean@emradar.net',contact_status:'VERIFIED',delivery_eligible:true,evidence_ids:['e1'],review_status:'READY'};
 const fingerprint=assetFingerprint(asset),state={id:'campaign',phase:'PUBLICATION_REVIEW',destinations:[destination],assets:{epoch:{asset,fingerprint}},decisions:{epoch:{authority:'OWNER',decision:'APPROVE',asset_sha256:fingerprint,campaign_id:'campaign',destination_id:'epoch'}},deliveries:{},events:[]};
 let version=1;
 const adapter={read:async()=>({version,value:structuredClone(state)}),compareAndSwap:async(_id,prior,next)=>{if(prior!==version)return false;version++;Object.assign(state,structuredClone(next));return true;}};
 const store=new CampaignStore(adapter);
 const contact={email:'press@epoch.ai',publication:'Epoch AI',purpose:'editorial',eligible:true,source_url:'https://epoch.ai/about/press',published_excerpt:'Press. For media queries, contact press@epoch.ai.',page_sha256:'b'.repeat(64)};
 const nextDestination={...structuredClone(destination),contact,contact_verified:true,delivery_eligible:true,contact_status:'VERIFIED',verification:{...destination.verification,method:'live_editorial_contact_page',status:'VERIFIED',source_url:contact.source_url}};
 return {state,store,adapter,fingerprint,contact,nextDestination};
}

test('verified recipient edit persists history, preserves copy, clears approval and requires approval of the new fingerprint',async()=>{
 const f=fixture();
 assert.equal(policy.verifiedDestination(f.state.destinations[0]),false,'a donation-purpose address must not qualify as an editorial recipient');
 assert.equal(policy.verifiedDestination(f.nextDestination),true);
 const workflow=new ReviewWorkflow({store:f.store,adapter:f.adapter,notify:async()=>{throw Error('NO_EMAILS');},baseUrl:'https://review.example',verifyRecipient:async input=>{
  assert.deepEqual(input,{campaignId:'campaign',destinationId:'epoch',fingerprint:f.fingerprint,email:'press@epoch.ai'});
  return f.nextDestination;
 }});
 workflow.authenticate=async()=>true;
 await workflow.revise('campaign','session','secret','epoch',f.fingerprint,{to:'press@epoch.ai'});
 const current=f.state.assets.epoch;
 assert.equal(current.asset.to,'press@epoch.ai');
 assert.equal(current.asset.subject,'Existing subject');assert.equal(current.asset.body,'Existing body\nRegards, Sean');
 assert.notEqual(current.fingerprint,f.fingerprint);assert.equal(f.state.decisions.epoch,undefined);
 assert.equal(f.state.destinations[0].contact.email,'press@epoch.ai');
 assert.equal(f.state.editorial_versions.epoch[0].asset.to,'donate@epoch.ai');
 assert(f.state.events.some(event=>event.type==='ASSET_REVISED'&&event.changed_fields.includes('to')));
 await assert.rejects(f.store.claimDelivery('campaign','epoch'),/OWNER_APPROVAL_REQUIRED/);
 await assert.rejects(f.store.decide('campaign','epoch','APPROVE',f.fingerprint),/INVALID_DECISION/);
 await f.store.decide('campaign','epoch','APPROVE',current.fingerprint);
 await f.store.claimDelivery('campaign','epoch');
 assert.equal(f.state.assets.epoch.asset.to,'press@epoch.ai');
 await assert.rejects(f.store.claimDelivery('campaign','epoch'),/DELIVERY_ALREADY_ATTEMPTED_OR_AMBIGUOUS/);
});

test('owner override saves a syntactically valid address after verifier failure, warns, preserves copy and clears stale approval',async()=>{
 const f=fixture(),workflow=new ReviewWorkflow({store:f.store,adapter:f.adapter,notify:async()=>{throw Error('NO_EMAILS');},baseUrl:'https://review.example',verifyRecipient:async()=>{throw Error('CONTACT_HTTP_403');}});
 workflow.authenticate=async()=>true;
 const result=await workflow.revise('campaign','session','secret','epoch',f.fingerprint,{to:'press@epoch.ai'});
 const current=f.state.assets.epoch;
 assert.equal(result.saved,true);assert.equal(result.recipient_warning,'CONTACT_HTTP_403');
 assert.equal(current.asset.to,'press@epoch.ai');assert.equal(current.asset.subject,'Existing subject');assert.equal(current.asset.body,'Existing body\nRegards, Sean');
 assert.equal(current.asset.contact_status,'OWNER_OVERRIDE');assert.equal(current.asset.recipient_owner_override,true);
 assert.equal(current.asset.recipient_verification.warning_code,'CONTACT_HTTP_403');assert.equal(f.state.decisions.epoch,undefined);
 assert.equal(f.state.destinations[0].contact.email,'press@epoch.ai');assert.equal(f.state.destinations[0].contact_verified,false);
 assert.equal(f.state.editorial_versions.epoch[0].asset.to,'donate@epoch.ai');
 const view=await workflow.view('campaign','session','secret');
 assert.equal(view.entries[0].recipient_ready,true);assert.equal(view.entries[0].recipient_warning,'CONTACT_HTTP_403');
 await assert.rejects(f.store.claimDelivery('campaign','epoch'),/OWNER_APPROVAL_REQUIRED/);
 const stale={authority:'OWNER',decision:'APPROVE',asset_sha256:f.fingerprint,campaign_id:'campaign',destination_id:'epoch'};
 await assert.rejects(Promise.resolve().then(()=>policy.assertSendableRecipient(current.asset,f.state.destinations[0],stale)),/V3_OWNER_APPROVAL_REQUIRED/);
 await f.store.decide('campaign','epoch','APPROVE',current.fingerprint);
 assert.equal(policy.assertSendableRecipient(current.asset,f.state.destinations[0],f.state.decisions.epoch),'press@epoch.ai');
 await f.store.claimDelivery('campaign','epoch');
 assert.equal(f.state.deliveries.epoch.status,'ATTEMPTING');
 assert.equal(f.state.assets.epoch.asset.to,'press@epoch.ai');
 await assert.rejects(f.store.claimDelivery('campaign','epoch'),/DELIVERY_ALREADY_ATTEMPTED_OR_AMBIGUOUS/);
});

test('owner override still rejects invalid syntax and opt-outs',async()=>{
 const f=fixture(),workflow=new ReviewWorkflow({store:f.store,adapter:f.adapter,notify:async()=>{},baseUrl:'https://review.example',verifyRecipient:async()=>{throw Error('CONTACT_HTTP_403');}});
 workflow.authenticate=async()=>true;
 await assert.rejects(workflow.revise('campaign','session','secret','epoch',f.fingerprint,{to:'bad\r\nBcc: victim@example.org'}),/V3_VALID_RECIPIENT_REQUIRED/);
 f.state.destinations[0].contact.opted_out=true;
 await assert.rejects(workflow.revise('campaign','session','secret','epoch',f.fingerprint,{to:'press@epoch.ai'}),/V3_RECIPIENT_OPTED_OUT/);
 assert.equal(f.state.assets.epoch.asset.to,'donate@epoch.ai');
});

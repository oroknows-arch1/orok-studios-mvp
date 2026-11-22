import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';
import {assetFingerprint, identicalEmailGroupKey} from '../vendor/emradar-v3/src/contracts.js';
import {prepareEditorialReview, recoveryCampaignId} from '../vendor/emradar-v3/src/editorial-preparation.js';
import {proposalBinding} from '../vendor/emradar-v3/src/proposal-verification.js';
import {MemoryAdapter} from '../vendor/emradar-v3-authoritative/src/adapters/memory.js';
import verifiedRecipient from './fixtures/v3-verified-recipient.cjs';

const groups = [
 ['web-1dba306b2ce44222946c','web-41d125fe9b1cb04ed743'],
 ['web-4870a9e4ba0628fe8a18'],
 ['web-4d314a0ef05cf11401b3'],
 ['web-4fe1ea184afb54885d7c','web-dbca4631364b50ccae39','web-fa58a91d82bad969d2a8'],
 ['web-748467d858923781ccbb'],
 ['web-88e37594305568f2b08d','web-cf33d4b5562dc9bfc1f3'],
 ['web-9001a71c92277b25cbe1'],
 ['web-ccdbd9aee8aebd7c93a6'],
 ['web-da1e36ee019dee508687'],
 ['web-e54d74de299dffe045e6'],
 ['web-eaabd5a6e7095e05a1b8'],
 ['x']
];
const corrected = new Set([0,5,6,11]);
const url='https://primary.example/announcement';
const quote='Decision 251 approves AVI 1 as the investor and proposes about 14,000 square metres of rental factories.';
const evidence=[{id:'fixture-source',verified:true,fact:quote,source_url:url}];
const id=recoveryCampaignId;

async function fixture(){
 const adapter=new MemoryAdapter(),store=new CampaignStore(adapter);
 const destinations=groups.flat().map(member=>member==='x'?{id:'x'}:verifiedRecipient(member,evidence));
 const assets={},proposal_verifications={},decisions={},email_groups={},group_approvals={};
 for(const [index,members] of groups.entries()){
  for(const member of members){
   const destination=destinations.find(item=>item.id===member);
   const asset={campaign_id:id,destination_id:member,kind:member==='x'?'X':'EMAIL',subject:'Proposal '+index,body:'Original '+index,evidence_ids:[evidence[0].id],review_status:'READY',...(member==='x'?{visual_url:'https://example.org/scan.png'}:{to:destination.contact.email,contact_status:'VERIFIED',delivery_eligible:true})};
   const fingerprint=assetFingerprint(asset);
   assets[member]={asset,fingerprint};
   if(corrected.has(index)&&member===members[0]){
    proposal_verifications[member]=[{id:'saved-'+index,...proposalBinding({asset,destination,evidence}),status:'REVISED_AND_VERIFIED',deliverable:true,sources:[{url}],claims:[{text:'Investor undisclosed',status:'CONTRADICTED'}],revised_proposal:{subject:'Proposal '+index,body:'Corrected '+index+' · '+quote}}];
    decisions[member]={authority:'OWNER',decision:'APPROVE',asset_sha256:fingerprint,campaign_id:id,destination_id:member};
   }
  }
  if(members.length>1){
   const item=assets[members[0]].asset,key='group-'+index;
   email_groups[key]={id:key,content_hash:identicalEmailGroupKey(item),version:1,subject:item.subject,body:item.body,destination_ids:members};
  }
 }
 group_approvals['group-0']={decision:'APPROVE',content_hash:email_groups['group-0'].content_hash,version:1};
 const state={id,phase:'PUBLICATION_REVIEW',assets,destinations,email_groups,group_approvals,decisions,deliveries:{},events:[],proposal_verifications,preparation_input:{document:{evidence}}};
 await adapter.compareAndSwap(id,null,state);
 const calls=[],reads=[];
 const assess=async({stage,proposal,destinations})=>{
  const index=Number(proposal.subject.split(' ').at(-1));
  calls.push([index,stage,proposal.body]);
  const ready=corrected.has(index)&&proposal.body.startsWith('Corrected')||index===2;
  return {status:ready?'VERIFIED':'INVESTIGATION_REQUIRED',deliverable:ready,contradictions:[],explanation:ready?'Evidence supports this version.':'Still unresolved.',
   fit:Object.fromEntries(destinations.map(({id:member})=>[member,ready&&member!=='web-cf33d4b5562dc9bfc1f3'])),
   claims:[{material:true,text:'The investor is named',status:'VERIFIED',passages:[{url,quote}]}]};
 };
 const input={store,campaignId:id,assess,readSource:async source=>{reads.push(source);return {url:source,text:quote,page_sha256:'a'.repeat(64)};},renderRevision:async(asset)=>({...asset,visual_url:'https://example.org/revised-scan.png'})};
 return {state,store,adapter,calls,reads,input};
}

test('22 November recovery classifies all 16, independently checks four saved revisions and applies exact copies',async()=>{
 const {state,store,adapter,calls,reads,input}=await fixture();
 const first=groups[0][0],alternate=groups[0][1],held=groups[1][0];
 await assert.rejects(store.decide(id,first,'APPROVE',state.assets[first].fingerprint),/EDITORIAL_CHECK_REQUIRED/);
 await assert.rejects(store.claimDelivery(id,first),/EDITORIAL_CHECK_REQUIRED/);
 const outcomes=await prepareEditorialReview(input);
 assert.equal(Object.keys(outcomes).length,16);
 assert.equal(outcomes[first],'CORRECTED_READY');
 assert.equal(outcomes[alternate],'CORRECTED_READY');
 assert.equal(outcomes[groups[5][1]],'INVESTIGATION_REQUIRED','shared facts do not prove another outlet is suitable');
 assert.equal(outcomes[groups[2][0]],'READY_VERIFIED');
 assert.equal(outcomes.x,'CORRECTED_READY');
 assert.equal(outcomes[held],'INVESTIGATION_REQUIRED');
 assert.equal(calls.length,12);
 assert.equal(reads.length,1,'one full-source retrieval across shared evidence');
 assert.deepEqual(calls.slice(0,4).map(call=>call[1]),['CHECK','CHECK','CHECK','CHECK']);
 const after=(await adapter.read(id)).value;
 assert.deepEqual(after.proposal_verifications,state.proposal_verifications);
 assert.equal(after.editorial_versions[first][0].asset.body,'Original 0');
 assert.equal(after.editorial_versions[first][0].previous_decision.asset_sha256,state.assets[first].fingerprint);
 assert.equal(after.assets[first].asset.body,after.assets[alternate].asset.body);
 assert.equal(after.assets.x.asset.visual_url,'https://example.org/revised-scan.png');
 assert.deepEqual(after.deliveries,{});
 assert.equal(after.group_approvals['group-0'],undefined);
 assert.equal(after.email_groups['group-0'].version,2);
 assert.equal(after.decisions[first],undefined);
 await assert.rejects(store.decide(id,first,'APPROVE',state.assets[first].fingerprint),/INVALID_DECISION/);
 await assert.rejects(store.decide(id,held,'APPROVE',after.assets[held].fingerprint),/EDITORIAL_CHECK_REQUIRED/);
 await assert.rejects(store.decideGroup(id,'group-5','APPROVE',after.email_groups['group-5'].content_hash,2),/EDITORIAL_CHECK_REQUIRED/);
 await store.decide(id,groups[5][0],'APPROVE',after.assets[groups[5][0]].fingerprint);
 assert.equal((await adapter.read(id)).value.decisions[groups[5][0]].decision,'APPROVE');
 const beforeReplay=(await adapter.read(id)).version;
 assert.deepEqual(await prepareEditorialReview(input),outcomes);
 assert.equal((await adapter.read(id)).version,beforeReplay);
 assert.equal(calls.length,12);
});

test('a fabricated passage cannot release a correction and a prior send survives untouched',async()=>{
 const {state,store,adapter,input}=await fixture();
 const sent=groups[0][1],unverified=groups[0][0];
 const delivery={status:'ACCEPTED',receipt:{provider_id:'previous-send'}};
 await store.mutate(id,current=>{current.deliveries[sent]=delivery;return current;});
 const outcomes=await prepareEditorialReview({...input,assess:async()=>({
  status:'VERIFIED',deliverable:true,fit:{[unverified]:true},contradictions:[],claims:[{material:true,text:'Unsupported',status:'VERIFIED',passages:[{url,quote:'A fabricated passage of plausible length.'}]}]
 })});
 const after=(await adapter.read(id)).value;
 assert.equal(outcomes[unverified],'INVESTIGATION_REQUIRED');
 assert.equal(outcomes[sent],'HISTORICAL');
 assert.deepEqual(after.assets[unverified],state.assets[unverified]);
 assert.deepEqual(after.assets[sent],state.assets[sent]);
 assert.deepEqual(after.deliveries[sent],delivery);
});

test('a corrected invitation preserves the previous permanent link and sends once',async()=>{
 const {store,adapter}=await fixture();
 const alerts=[];
 const workflow=new ReviewWorkflow({store,adapter,baseUrl:'https://review.example',notify:async input=>{
  alerts.push(input);
  return {accepted:true,provider_id:'purelymail-'+alerts.length,recipient:'sean@emradar.net',campaign_id:id};
 }});
 await workflow.issue(id,{revisionId:'previous'});
 const originalToken=new URLSearchParams(new URL(alerts[0].link).hash.slice(1)).get('token');
 const session=await workflow.exchange(id,originalToken);
 await workflow.issue(id,{revisionId:'corrected'});
 await workflow.issue(id,{revisionId:'corrected'});
 await workflow.authenticate(id,session.sessionId,session.secret);
 await workflow.exchange(id,originalToken);
 const record=(await adapter.read('review:'+id)).value;
 assert.equal(record.notification_receipt.provider_id,'purelymail-2');
 assert.equal(record.previous_reviews[0].notification_receipt.provider_id,'purelymail-1');
 assert.equal(alerts.length,2);
});

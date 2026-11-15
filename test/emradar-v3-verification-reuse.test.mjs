import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';
import {proposalBinding} from '../vendor/emradar-v3/src/proposal-verification.js';
import {assetFingerprint} from '../vendor/emradar-v3/src/contracts.js';

const make=()=>{
 const id='campaign-1',evidence=[{id:'E1',fact:'verified evidence',source_url:'https://example.org'}];
 const asset=(destination_id,body='Identical fact supported by E1')=>({campaign_id:id,destination_id,kind:'EMAIL',subject:'One story',body,evidence_ids:['E1']});
 const campaign={assets:{a:{asset:asset('a'),fingerprint:assetFingerprint(asset('a'))},b:{asset:asset('b'),fingerprint:assetFingerprint(asset('b'))}},destinations:[{id:'a',name:'Outlet A'},{id:'b',name:'Outlet B'}],preparation_input:{document:{evidence}},proposal_verifications:{}};
 let calls=0;
 const workflow={
  authenticate:async()=>{},
  clock:()=>Date.parse('2026-11-15T01:00:00Z'),
  store:{adapter:{read:async()=>({value:campaign})},recordProposalVerification:async(_,destinationId,__,verification)=>{(campaign.proposal_verifications[destinationId]??=[]).push(verification)}},
  verifier:{verify:async({asset,destination,evidence})=>{calls++;return {...proposalBinding({asset,destination,evidence}),id:'verification-'+calls,status:'VERIFIED',deliverable:true,claims:[{id:'c1',text:'Fact',material:true,status:'VERIFIED'}],contradictions:[],sources:[{url:'https://example.org'}],explanation:'Source matched',verified_at:'2026-11-15T01:00:00Z',expires_at:'2026-11-16T01:00:00Z'}}}
 };
 return {campaign,workflow,calls:()=>calls,id};
};
const verify=(f,dest)=>ReviewWorkflow.prototype.verifyAgain.call(f.workflow,f.id,'session','secret',dest,f.campaign.assets[dest].fingerprint);

test('repeated owner verification reuses a bound valid result without a second AI call',async()=>{
 const f=make();const first=await verify(f,'a');const second=await verify(f,'a');
 assert.equal(f.calls(),1);assert.equal(first.reused,false);assert.equal(second.reused,true);
 assert.equal(second.reuse_reason,'UNCHANGED_PROPOSAL');
});
test('identical email research is reused across recipients but rebound to the exact recipient',async()=>{
 const f=make();const first=await verify(f,'a');const second=await verify(f,'b');
 assert.equal(f.calls(),1);assert.equal(second.reused,true);
 assert.equal(second.reuse_reason,'IDENTICAL_CONTENT_AND_EVIDENCE');
 assert.equal(second.reused_from_verification_id,first.id);
 assert.equal(second.destination_id,'b');assert.equal(second.asset_sha256,proposalBinding({asset:f.campaign.assets.b.asset,destination:f.campaign.destinations[1],evidence:f.campaign.preparation_input.document.evidence}).asset_sha256);
 assert.notEqual(first.id,second.id);
});
test('materially different copy must run independent verification',async()=>{
 const f=make();f.campaign.assets.b.asset.body='A different factual assertion';f.campaign.assets.b.fingerprint=assetFingerprint(f.campaign.assets.b.asset);
 await verify(f,'a');const result=await verify(f,'b');
 assert.equal(f.calls(),2);assert.equal(result.reused,false);
});
test('failed or expired verifications cannot be recycled',async()=>{
 const f=make();await verify(f,'a');f.campaign.proposal_verifications.a[0].status='INVESTIGATION_REQUIRED';
 await verify(f,'b');assert.equal(f.calls(),2);
 const g=make();g.workflow.clock=()=>Date.parse('2026-11-17T01:00:00Z');await verify(g,'a');await verify(g,'b');assert.equal(g.calls(),2);
});

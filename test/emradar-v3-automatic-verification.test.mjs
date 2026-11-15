import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticallyVerifyProposals} from '../vendor/emradar-v3/src/automatic-proposal-verification.js';
import {assetFingerprint} from '../vendor/emradar-v3/src/contracts.js';
import {proposalBinding} from '../vendor/emradar-v3/src/proposal-verification.js';

const asset=(id,body)=>({campaign_id:'campaign',destination_id:id,kind:'EMAIL',to:id+'@example.test',subject:'Pitch',body,evidence_ids:['e1']});
function fixture(){
 const bodies={a:'Shared',b:'Shared',c:'Distinct',d:'Held'},assets=Object.fromEntries(Object.entries(bodies).map(([id,body])=>{const value=asset(id,body);return [id,{asset:value,fingerprint:assetFingerprint(value)}]}));
 const state={phase:'PUBLICATION_REVIEW',assets,destinations:Object.keys(assets).map(id=>({id,name:id})),preparation_input:{document:{evidence:[{id:'e1',fact:'Fact',source_url:'https://example.test'}]}},proposal_verifications:{},events:[]};
 let calls=0,summary;
 const store={adapter:{read:async()=>({value:state})},recordProposalVerification:async(_,id,__,record)=>{(state.proposal_verifications[id]??=[]).push(record);},recordAutomaticVerificationRun:async(_,value)=>{summary=value;state.automatic_proposal_verification=value;}};
 const verifier={verify:async({asset:proposal,destination,evidence})=>{calls++;return {id:'verification-'+calls,...proposalBinding({asset:proposal,destination,evidence}),status:'VERIFIED',deliverable:true,claims:[{id:'c1',text:'Fact',material:true,status:'VERIFIED'}],contradictions:[],sources:[{url:'https://example.test'}],revised_proposal:null,explanation:'Verified',verified_at:'2026-11-15T00:00:00Z',expires_at:'2026-11-16T00:00:00Z'};}};
 return {state,store,verifier,get calls(){return calls;},get summary(){return summary;}};
}

test('automatic pass verifies distinct proposals, reuses only successful exact-content evidence and persists budget status',async()=>{
 const f=fixture();await automaticallyVerifyProposals({store:f.store,campaignId:'campaign',verifier:f.verifier,maxInvestigations:2,clock:()=>Date.parse('2026-11-15T01:00:00Z')});
 assert.equal(f.calls,2);assert.equal(f.state.proposal_verifications.a.length,1);assert.equal(f.state.proposal_verifications.b[0].reused_from_verification_id,'verification-1');
 assert.equal(f.state.proposal_verifications.c[0].status,'VERIFIED');assert.equal(f.state.proposal_verifications.d[0].failure_code,'AUTOMATIC_VERIFICATION_BUDGET_EXHAUSTED');
 assert.equal(f.summary.status,'PARTIAL_BUDGET_LIMIT');assert.equal(f.summary.distinct_proposals,3);assert.equal(f.summary.investigations_used,2);assert.equal(f.summary.reused_successes,1);assert.equal(f.summary.verified,3);assert.equal(f.summary.budget_held,1);assert.match(f.summary.assets_digest,/^[a-f0-9]{64}$/);
 await automaticallyVerifyProposals({store:f.store,campaignId:'campaign',verifier:f.verifier,maxInvestigations:2,clock:()=>Date.parse('2026-11-15T02:00:00Z')});assert.equal(f.calls,2,'persisted run prevents another paid pass for unchanged assets');
});

test('failed findings are not reused as verified evidence',async()=>{
 const f=fixture();f.verifier.verify=async({asset:proposal,destination,evidence})=>({id:'failed',...proposalBinding({asset:proposal,destination,evidence}),status:'INVESTIGATION_REQUIRED',deliverable:false,claims:[],contradictions:[],sources:[],revised_proposal:null,explanation:'Unavailable',failure_code:'PROVIDER_UNAVAILABLE',verified_at:'2026-11-15T00:00:00Z',expires_at:'2026-11-15T00:00:00Z'});
 await automaticallyVerifyProposals({store:f.store,campaignId:'campaign',verifier:f.verifier,maxInvestigations:3,clock:()=>Date.parse('2026-11-15T01:00:00Z')});
 assert.equal(f.state.proposal_verifications.a[0].id,'failed');assert.equal(f.state.proposal_verifications.b[0].failure_code,'IDENTICAL_PROPOSAL_NOT_VERIFIED');assert.equal(f.state.proposal_verifications.b[0].reused_from_verification_id,undefined);
});

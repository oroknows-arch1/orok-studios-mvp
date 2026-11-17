import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertGatedDocument,createClaimEvidenceGate,publicEvidenceUrl} from '../vendor/emradar-v3/src/claim-evidence-gate.js';
import {createPreparationRun} from '../vendor/emradar-v3/src/preparation-run.js';
import {createPublicationReviewHandoff} from '../vendor/emradar-v3/src/publication-review-handoff.js';
import {normalizePublishedEvidence} from '../vendor/emradar-v3/src/scan-evidence-adapter.js';
import {createClaimGatedVisualRenderer} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {assertProductionProposal,writeVerifiedProposal} from '../vendor/emradar-v3/src/verified-proposal-policy.js';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {assetFingerprint} from '../vendor/emradar-v3/src/contracts.js';
import {quarantineUnsupported} from '../vendor/emradar-v3/src/evidence-quarantine.js';
import {deriveDiscoveryContext} from '../vendor/emradar-v3/src/autonomous-outlet-discovery.js';
import {article,change,consequence,fixtureGate,leads,pages,scan,scanHash,selection} from './fixtures/claim-proof.mjs';

const require=createRequire(import.meta.url);
const recipient=require('./fixtures/v3-verified-recipient.cjs');
const {createV3ApprovalVerifier}=require('../src/emradar-v3-approval-verifier.cjs');
const liveUrl='https://emerging-markets-radar.onrender.com/data/discovery.json';
const archiveUrl='https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-2026-11-17.json';
const parameters={snapshotDate:scan.snapshot_date,expectedSha256:scanHash,liveUrl,archiveUrl};
const fetcher=async ()=>new Response(JSON.stringify(leads));
const input={scan,document:normalizePublishedEvidence(leads)};
const makeStore=()=>{
 const records=new Map();
 const adapter={read:async id=>structuredClone(records.get(id)),compareAndSwap:async(id,expected,value)=>{
  const version=records.get(id)?.version??null;
  if(version!==expected)return false;
  records.set(id,{version:(version??0)+1,value:structuredClone(value)});return true;
 }};
 return new CampaignStore(adapter,{assertProposal:assertProductionProposal});
};

test('full retrieved sources recover a narrower story and exclude the unsupported launch and claimed capacity',async ()=>{
 const attempted=[];
 const gate=fixtureGate({readPage:async url=>{attempted.push(url.href);if(!pages[url.href])throw Error('HTTP_403');return pages[url.href];}});
 const document=await gate(input);
 assert.equal(attempted.length,3);
 assertGatedDocument(document,scan);
 assert.deepEqual(document.evidence.map(item=>item.fact),[change,consequence]);
 assert.deepEqual(deriveDiscoveryContext(document).industries,['Transport']);
 assert.equal(document.records[0].status,'INVESTIGATE');
 assert.doesNotMatch(JSON.stringify(document),/900%|commissioning|blocked\.example/);
 assert.throws(()=>assertGatedDocument({...document,records:[{...document.records[0],theme:'Unsupported increase'}]},scan),/VERIFIED_CLAIM_EVIDENCE_REQUIRED/);
});

test('URLs, teaser and paywall pages, same-publisher copies and unsupported model choices cannot pass',async ()=>{
 for(const overrides of [
  {readPage:async()=>'<meta name="description" content="Search snippet">'},
  {readPage:async()=>article(change)+'<script>{"isAccessibleForFree":false}</script>'},
  {readPage:async()=>'<article><p>'+change+'</p></article>'},
  {readPage:async()=>article(change)+'<p>Subscribe to continue reading</p>'},
  {readPage:async()=>article(change)},
  {searchAlternatives:async()=>['https://port.example/releases/terminal','https://www.port.example/releases/duplicate'],
   readPage:async url=>url.hostname==='www.port.example'?article(consequence):url.hostname==='port.example'?article(change):''},
  {assess:async()=>({...selection,premises:[{page:8,paragraph:0,sentence:0,role:'CHANGE'},selection.premises[1]]})},
  {assess:async()=>({...selection,premises:[{page:0,paragraph:0,sentence:0,role:'CHANGE'}, {...selection.premises[0],role:'CONSEQUENCE'}]})},
  {assess:async()=>({...selection,contradiction:true})},
  {assess:async()=>({...selection,significant:false})},
  {assess:async()=>{throw Error('TIMEOUT');}}
 ]) assert.equal((await fixtureGate(overrides)(input)).evidence.length,0);
 for(const url of ['http://source.example/article','https://127.1/file','https://[::1]/file','https://user:pw@source.example/a','https://emradar.net/scan','https://port.example/'])
  assert.equal(publicEvidenceUrl(url),null);
 assert.throws(()=>assertGatedDocument({evidence:[{id:'fake',verified:true,fact:'Fiction',source_url:'https://port.example/a'}]},scan),/VERIFIED_CLAIM_EVIDENCE_REQUIRED/);
});

test('weak candidates do not consume a proposal slot and the investigation budget is enforced',async ()=>{
 const document={...input.document,evidence:[
  {...input.document.evidence[0],id:'weak',record_id:'weak'},
  ...input.document.evidence,{...input.document.evidence[0],id:'held',record_id:'held'}],
  records:[{id:'weak'},...input.document.records,{id:'held'}]};
 let searches=0,assessments=0;
 const result=await fixtureGate({maxInvestigations:2,searchAlternatives:async()=>{searches++;return Object.keys(pages);},
  assess:async()=>++assessments===1?{...selection,significant:false}:selection})({scan,document});
 assert.deepEqual(result.evidence_gate.outcomes.map(item=>item.status),
  ['NO_SUPPORTED_SIGNIFICANT_ANGLE','VERIFIED_PREMISES_FORMATION_UNRESOLVED','BUDGET_HELD']);
 assert.equal(searches,2);
 assert.throws(()=>createClaimEvidenceGate({maxInvestigations:9}),/CLAIM_EVIDENCE_PROVIDERS_REQUIRED/);
});

test('signed scan reaches routers, exact email and real PNG in owner review after proof, without sending',async ()=>{
 const store=makeStore();
 const calls=[];
 const renderVisual=createClaimGatedVisualRenderer();
 const doPrepare=createPreparationRun({store,fetcher,gateEvidence:async value=>{calls.push('gate');return fixtureGate()(value);},
  discover:async({document})=>{
   calls.push('router');
   assertGatedDocument(document,scan);
   return [{id:'x',category:'social',evidence:{ids:document.evidence.map(item=>item.id)},contact_verified:true},recipient('journal',document.evidence)];
  },
  write:async args=>{calls.push('writer');return writeVerifiedProposal(args);},renderVisual});
 let reviewCalls=0;
 const prepareAndReview=createPublicationReviewHandoff({prepare:doPrepare,workflow:{issue:async campaignId=>{reviewCalls++;return {campaignId,status:'NOTIFIED'};}}});
 await assert.rejects(doPrepare({...parameters,expectedSha256:'0'.repeat(64)}),/UNVERIFIED_PUBLICATION/);
 const {campaignId}=await prepareAndReview(parameters);
 const state=(await store.adapter.read(campaignId)).value;
 assert.equal(state.phase,'PUBLICATION_REVIEW');
 assert.equal(state.assets.journal.asset.review_status,'READY');
 assert.match(state.assets.journal.asset.body,/remains under investigation/);
 assert.doesNotMatch(state.assets.journal.asset.body,/900%/);
 assert.ok(state.assets.x.asset.visual_base64);
 assert.equal(state.assets.x.asset.visual_mime,'image/png');
 assert.deepEqual(Object.keys(state.deliveries),[]);
 assert.deepEqual(calls,['gate','router','writer','writer']);
 assert.equal(reviewCalls,1);
 assert.equal((await doPrepare(parameters)).status,'ALREADY_PREPARED');
 assert.deepEqual(calls,['gate','router','writer','writer']);

 const saved=state.assets.journal;
 await store.revise(campaignId,'journal',saved.fingerprint,{body:saved.asset.body+'\nThe project is commissioned.'});
 const edited=(await store.adapter.read(campaignId)).value.assets.journal;
 await assert.rejects(store.decide(campaignId,'journal','APPROVE',edited.fingerprint),/INCOMPLETE_ASSET_CANNOT_BE_APPROVED/);
 await assert.rejects(store.claimDelivery(campaignId,'journal'),/INCOMPLETE_ASSET_NOT_SENDABLE/);
});

test('zero proof skips routing, writing and owner notification, including repeated polls',async ()=>{
 const store=makeStore();
 let runs=0;
 const unexpected=()=>assert.fail('No worker may receive unsupported claims');
 const prepare=createPreparationRun({store,fetcher,gateEvidence:async data=>{runs++;return fixtureGate({searchAlternatives:async()=>[]})(data);},
  discover:unexpected,write:unexpected,renderVisual:unexpected});
 const handoff=createPublicationReviewHandoff({prepare,workflow:{issue:unexpected}});
 assert.equal((await handoff(parameters)).status,'NO_VERIFIED_ANGLE');
 assert.equal((await handoff(parameters)).status,'NO_VERIFIED_ANGLE');
 assert.equal(runs,1);
});

test('interrupted or concurrent work does not obtain a second paid budget',async ()=>{
 const store=makeStore();
 let runs=0;
 const unexpected=()=>assert.fail('Gated step unexpectedly executed');
 const prepare=createPreparationRun({store,fetcher,gateEvidence:async()=>{runs++;throw Error('PROVIDER_INTERRUPTED');},
  discover:unexpected,write:unexpected,renderVisual:unexpected});
 const results=await Promise.allSettled([prepare(parameters),prepare(parameters)]);
 assert.deepEqual(results.map(item=>item.status).sort(),['fulfilled','rejected']);
 assert.equal(results.find(item=>item.status==='fulfilled').value.status,'CLAIM_EVIDENCE_RUN_HELD');
 assert.equal((await prepare(parameters)).status,'CLAIM_EVIDENCE_RUN_HELD');
 assert.equal(runs,1);
});

test('release verifier blocks forged owner approval or direct call without matching claim proof',async ()=>{
 const id='v3-proof-test',destination_id='x';
 const asset={kind:'X',campaign_id:id,destination_id,body:'An unsupported claim',evidence_ids:['a','b'],review_status:'READY'};
 const fingerprint=assetFingerprint(asset);
 const approval={authority:'OWNER',decision:'APPROVE',campaign_id:id,destination_id,asset_sha256:fingerprint};
 const {sha256}=await import('../vendor/emradar-v3/src/contracts.js');
 const idempotency_key=sha256([id,destination_id,fingerprint]);
 const state={scan,phase:'PUBLICATION_REVIEW',destinations:[{id:destination_id}],assets:{x:{asset,fingerprint}},decisions:{x:approval},deliveries:{x:{status:'ATTEMPTING',idempotency_key}}};
 const verify=createV3ApprovalVerifier({pool:{query:async()=>({rows:[{payload:state}]})}});
 await assert.rejects(verify({campaign_id:id,destination_id,asset,approval,idempotency_key}),/VERIFIED_CLAIM_EVIDENCE_REQUIRED/);
});

test('quarantine archives originals and stale approvals, and preserves sent and ambiguous outcomes',async ()=>{
 const id='v3-fixture';
 const state={id,scan,phase:'PUBLICATION_REVIEW',assets:{},decisions:{},deliveries:{},email_groups:{group:{id:'group',destination_ids:['draft','accepted','ambiguous','reserved'],version:1}},group_approvals:{group:{decision:'APPROVE'}}};
 for(const key of ['draft','accepted','ambiguous','reserved','failed']){
  const asset={campaign_id:id,destination_id:key,kind:'EMAIL',body:'Unsupported material',review_status:'READY'};
  const fingerprint=assetFingerprint(asset);
  state.assets[key]={asset,fingerprint};
  state.decisions[key]={decision:'APPROVE',authority:'OWNER',asset_sha256:fingerprint};
 }
 state.deliveries={accepted:{status:'ACCEPTED',provider_id:'receipt'},ambiguous:{status:'AMBIGUOUS'},failed:{status:'FAILED_DEFINITELY_UNSENT'}};
 const original=structuredClone(state);
 const apply=value=>quarantineUnsupported(value,new Set(['reserved']),{fingerprint:assetFingerprint,createGroups:()=>({})});
 const updated=apply(state);
 assert.deepEqual(Object.keys(updated.evidence_quarantine),['draft','failed']);
 assert.equal(updated.assets.draft.asset.review_status,'NEEDS_REVISION');
 assert.notEqual(updated.assets.draft.fingerprint,original.assets.draft.fingerprint);
 assert.equal(updated.editorial_versions.draft[0].asset.body,'Unsupported material');
 assert.deepEqual(updated.editorial_versions.draft[0].previous_decision,original.decisions.draft);
 assert.equal(updated.decisions.draft,undefined);
 assert.equal(updated.group_approvals.group,undefined);
 for(const key of ['accepted','ambiguous','reserved']){
  assert.deepEqual(updated.assets[key],original.assets[key]);assert.deepEqual(updated.decisions[key],original.decisions[key]);
 }
 assert.deepEqual(updated.deliveries,original.deliveries);
 assert.deepEqual(apply(structuredClone(updated)),updated);
});

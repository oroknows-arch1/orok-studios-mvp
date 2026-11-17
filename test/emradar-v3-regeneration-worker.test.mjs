import {verifiedReleaseFixture} from './fixtures/claim-proof.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparationReviewService} from '../vendor/emradar-v3/src/preparation-review-service.js';
import {assetFingerprint} from '../vendor/emradar-v3/src/contracts.js';

test('rejected asset regenerates from saved proof and retains the feedback and preserves unrelated approved assets',async()=>{
 const proof=await verifiedReleaseFixture(),journal=proof.email('journal').destination;
 const prior={...proof.email('journal').asset,body:'Rejected copy',subject:'Rejected subject'};
 const x={...proof.x.asset,visual_url:'data:image/png;base64,AA=='};
 const feedback='Explain the verified capacity constraint and keep the caveat visible.';
 let state={id:'campaign',...proof.state,phase:'PUBLICATION_REVIEW',destinations:[journal,proof.x.destination],assets:{journal:{asset:prior,fingerprint:assetFingerprint(prior)},x:{asset:x,fingerprint:assetFingerprint(x)}},decisions:{journal:{authority:'OWNER',decision:'REJECT',asset_sha256:assetFingerprint(prior),campaign_id:'campaign',destination_id:'journal'},x:{authority:'OWNER',decision:'APPROVE',asset_sha256:assetFingerprint(x),campaign_id:'campaign',destination_id:'x'}},deliveries:{},review_actions:{journal:{action:'REGENERATE',status:'RUNNING',request_id:'request-1',revision_id:'review-request-1',asset_sha256:assetFingerprint(prior),feedback}},review_feedback:[{id:'request-1',destination_id:'journal',asset_sha256:assetFingerprint(prior),feedback}],events:[],editorial_versions:{}};
 let version=1;
 const pool={query:async(sql,params=[])=>{
  if(sql.startsWith('SELECT version,payload FROM v3_campaign_state'))return {rows:[{version,payload:structuredClone(state)}]};
  if(sql.startsWith('UPDATE v3_campaign_state')){if(Number(params[1])!==version)return {rowCount:0};state=JSON.parse(params[2]);version++;return {rowCount:1};}
  if(sql.includes('FROM v3_outlet_directory'))return {rows:[]};
  return {rows:[],rowCount:0};
 }};
 const service=await createPreparationReviewService({pool,reviewOrigin:'https://review.example',notify:async()=>({accepted:true,provider_id:'owner-mail',recipient:'sean@emradar.net',campaign_id:'campaign'}),reviewedLinks:[],gateEvidence:async()=>{throw Error('NO_RESEARCH_REPEAT');},renderVisual:async()=>{throw Error('X_WORKER_MUST_NOT_RUN');},fetcher:async()=>({ok:false})});
 const result=await service.regenerateRejectedAsset('campaign','journal','request-1');
 assert.equal(result.status,'OWNER_REVIEW_PENDING');
 assert.equal(state.assets.journal.asset.body,proof.email('journal').asset.body);assert.notEqual(state.assets.journal.fingerprint,assetFingerprint(prior));
 assert.equal(state.editorial_versions.journal.length,1);assert.equal(state.editorial_versions.journal[0].feedback,state.review_feedback[0].feedback);
 assert.equal(state.decisions.journal,undefined);assert.equal(state.review_actions.journal.status,'OWNER_REVIEW_PENDING');
 assert.equal(state.decisions.x.decision,'APPROVE');assert.equal(state.assets.x.fingerprint,assetFingerprint(x));
 assert.equal(state.phase,'PUBLICATION_REVIEW');assert.equal(state.review_completion.review_ready,true);
});

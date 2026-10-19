import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparationReviewService} from '../vendor/emradar-v3/src/preparation-review-service.js';
import {assetFingerprint} from '../vendor/emradar-v3/src/contracts.js';

test('rejected asset regenerates once from persisted feedback and preserves unrelated approved assets',async()=>{
 const evidence={id:'e1',verified:true,fact:'Published evidence supports a specific capacity constraint.'};
 const journal={id:'journal',name:'Journal',destination_class:'EDITORIAL_PUBLICATION',website:'https://journal.example',active:true,publication_verified:true,editorial_fit_verified:true,contact_verified:true,delivery_eligible:true,relationship:{formation_ids:['formation-1'],industries:['manufacturing'],reason:'The verified report directly relates to the publication.'},verification:{status:'VERIFIED',method:'live_editorial_contact_page',publication_status:'VERIFIED',publication_page_sha256:'a'.repeat(64),publication_proof_url:'https://journal.example/about',evidence_ids:['e1'],scan_evidence_digest:'b'.repeat(64)},contact:{email:'editor@journal.example',source_url:'https://journal.example/contact',purpose:'editorial',published_excerpt:'Editorial contact editor@journal.example',page_sha256:'c'.repeat(64)},evidence:{ids:['e1']}};
 const prior={campaign_id:'campaign',destination_id:'journal',kind:'EMAIL',subject:'Rejected subject',body:'Rejected copy',from:'sean@emradar.net',to:'editor@journal.example',contact_status:'VERIFIED',delivery_eligible:true,evidence_ids:['e1'],review_status:'READY'};
 const x={campaign_id:'campaign',destination_id:'x',kind:'X',subject:'Unchanged X',body:'Unchanged X text',evidence_ids:['e1'],visual_sha256:'d'.repeat(64),visual_url:'data:image/png;base64,AA==',review_status:'READY'};
 let state={id:'campaign',phase:'PUBLICATION_REVIEW',scan:{snapshot_date:'2026-10-19'},preparation_input:{document:{evidence:[evidence],uncertainty:[]}},destinations:[journal,{id:'x',category:'social',evidence:{ids:['e1']}}],assets:{journal:{asset:prior,fingerprint:assetFingerprint(prior)},x:{asset:x,fingerprint:assetFingerprint(x)}},decisions:{journal:{authority:'OWNER',decision:'REJECT',asset_sha256:assetFingerprint(prior),campaign_id:'campaign',destination_id:'journal'},x:{authority:'OWNER',decision:'APPROVE',asset_sha256:assetFingerprint(x),campaign_id:'campaign',destination_id:'x'}},deliveries:{},review_actions:{journal:{action:'REGENERATE',status:'RUNNING',request_id:'request-1',revision_id:'review-request-1',asset_sha256:assetFingerprint(prior),feedback:'Explain the verified capacity constraint and keep the caveat visible.'}},review_feedback:[{id:'request-1',destination_id:'journal',asset_sha256:assetFingerprint(prior),feedback:'Explain the verified capacity constraint and keep the caveat visible.'}],events:[],editorial_versions:{}};
 let version=1,writerInput=null,generationCalls=0;
 const pool={query:async(sql,params=[])=>{
  if(sql.startsWith('SELECT version,payload FROM v3_campaign_state'))return {rows:[{version,payload:structuredClone(state)}]};
  if(sql.startsWith('UPDATE v3_campaign_state')){if(Number(params[1])!==version)return {rowCount:0};state=JSON.parse(params[2]);version++;return {rowCount:1};}
  if(sql.includes('FROM v3_outlet_directory'))return {rows:[]};
  return {rows:[],rowCount:0};
 }};
 const service=await createPreparationReviewService({pool,reviewOrigin:'https://review.example',notify:async()=>({accepted:true,provider_id:'owner-mail',recipient:'sean@emradar.net',campaign_id:'campaign'}),reviewedLinks:[],researchEvidence:async()=>({evidence:[]}),write:async input=>{writerInput=input;generationCalls++;return {...prior,subject:'Revised subject',body:'A revised evidence-grounded proposal.',html:undefined};},renderVisual:async()=>{throw Error('X_WORKER_MUST_NOT_RUN');},fetcher:async()=>({ok:false})});
 const result=await service.regenerateRejectedAsset('campaign','journal','request-1');
 assert.equal(result.status,'OWNER_REVIEW_PENDING');assert.equal(writerInput.ownerFeedback,state.review_feedback[0].feedback);assert.equal(generationCalls,1);
 assert.equal(state.assets.journal.asset.subject,'Revised subject');assert.notEqual(state.assets.journal.fingerprint,assetFingerprint(prior));
 assert.equal(state.editorial_versions.journal.length,1);assert.equal(state.editorial_versions.journal[0].feedback,state.review_feedback[0].feedback);
 assert.equal(state.decisions.journal,undefined);assert.equal(state.review_actions.journal.status,'OWNER_REVIEW_PENDING');
 assert.equal(state.decisions.x.decision,'APPROVE');assert.equal(state.assets.x.fingerprint,assetFingerprint(x));
 assert.equal(state.phase,'PUBLICATION_REVIEW');assert.equal(state.review_completion.review_ready,true);
});

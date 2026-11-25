import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {recoverCheckedX} from '../vendor/emradar-v3/src/checked-x-recovery.js';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {assetFingerprint} from '../vendor/emradar-v3/src/contracts.js';
import {proposalBinding} from '../vendor/emradar-v3/src/proposal-verification.js';
import {editorialStatus} from '../vendor/emradar-v3/src/editorial-preparation.js';
import {createVerifiedVisualRenderer} from '../vendor/emradar-v3/src/preparation-run.js';
import {composeGraphicSvg} from '../vendor/emradar-v3-authoritative/src/graphic-renderer.js';
import reconciliation from '../src/emradar-v3-reported-delivery.cjs';

test('held X uses another formation’s stored verified claims and a real country/company PNG; recovery is idempotent',async()=>{
 const url='https://publisher.example/publication', quote='The lender signed a loan for a planned facility in Brazil.';
 const evidence=[{id:'b:1',record_id:'b',verified:true,source_url:url,fact:quote}];
 const document={records:[{id:'b',theme:'Financing for a planned Brazilian facility',status:'FORMING',location:'Brazil',causal_chain:{connected_companies_and_tickers:['FS']}}],evidence};
 const base={campaign_id:'campaign',subject:'Unusable original',body:'Original',review_status:'READY'};
 const x={...base,kind:'X',destination_id:'x',story_record_id:'a',evidence_ids:[]};
 const email={...base,kind:'EMAIL',destination_id:'publisher',story_record_id:'b',evidence_ids:['b:1']};
 const entry=asset=>({asset,fingerprint:assetFingerprint(asset)});
 const destinations=[{id:'x'},{id:'publisher'}],assets={x:entry(x),publisher:entry(email)};
 const pass={url,quote,page_sha256:'a'.repeat(64)};
 const state={id:'campaign',phase:'PUBLICATION_REVIEW',assets,destinations,scan:{snapshot_date:'2026-11-25'},preparation_input:{document},
  deliveries:{},decisions:{publisher:{decision:'APPROVE'}},events:[],editorial_preparation:{outcomes:{
   publisher:{id:'original',...proposalBinding({asset:email,destination:destinations[1],evidence}),sources:[pass],
   claims:[{text:quote,status:'VERIFIED',passages:[{url,quote}]},{text:'unsupported outcomes',status:'UNRESOLVED',passages:[]}]}}}};
 let saved=structuredClone(state),version=1;
 const adapter={read:async()=>({version,value:structuredClone(saved)}),compareAndSwap:async(_id,expected,next)=>{assert.equal(expected,version++);saved=next;return true;}};
 const store=new CampaignStore(adapter);
 const render=createVerifiedVisualRenderer(async input=>{
  const card=composeGraphicSvg(input);return {...card,bytes:await sharp(Buffer.from(card.svg)).png().toBuffer()};
 });
 const renderRevision=async(asset,snapshot)=>{const visual=await render({asset,document:snapshot.preparation_input.document,scan:snapshot.scan});return {...asset,visual_url:visual.url,visual_sha256:visual.sha256};};
 const run=()=>recoverCheckedX({store,campaignId:'campaign',renderRevision});
 assert.equal(await run(),true);
 const next=saved.assets.x.asset;
 assert.equal(next.story_record_id,'b');assert.match(next.body,/FORMING/);assert.ok(next.body.includes(url));
 assert.ok(!next.body.includes('unsupported outcomes'));assert.equal(editorialStatus(saved,'x'),'CORRECTED_READY');
 const bytes=Buffer.from(next.visual_base64,'base64');
 assert.equal((await sharp(bytes).metadata()).format,'png');assert.equal(createHash('sha256').update(bytes).digest('hex'),next.visual_sha256);
 assert.equal(next.visual_diagnostics.rendered_geography[0].country,'Brazil');
 assert.match(next.visual_diagnostics.rendered_geography[0].companies,/FS/);
 assert.deepEqual(saved.editorial_versions.x[0].asset,x);assert.deepEqual(saved.assets.publisher,assets.publisher);
 assert.deepEqual(saved.decisions,state.decisions);assert.equal(await run(),false);
});

test('a possible manual Sent copy is held independently and never labelled accepted',async()=>{
 const {campaignId,reported,reconcileReportedEmail}=reconciliation,id=reported[0];
 const state={id:campaignId,assets:{[id]:{asset:{to:'editor@example.org'},fingerprint:'abc'}},deliveries:{}};
 const store={mutate:async(_id,fn)=>fn(state)};
 await assert.rejects(reconcileReportedEmail({pool:{query:async()=>({rows:[]})},store,state,id,inspect:async()=>({matches:1})}),/RECONCILIATION_REQUIRED/);
 assert.equal(state.deliveries[id].status,'AMBIGUOUS');assert.equal(state.deliveries[id].receipt.provider_id,undefined);
});

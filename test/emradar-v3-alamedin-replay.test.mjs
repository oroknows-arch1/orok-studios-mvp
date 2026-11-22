import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {prepareEditorialReview} from '../vendor/emradar-v3/src/editorial-preparation.js';
import {assetFingerprint} from '../vendor/emradar-v3/src/contracts.js';
import {proposalBinding} from '../vendor/emradar-v3/src/proposal-verification.js';
import {MemoryAdapter} from '../vendor/emradar-v3-authoritative/src/adapters/memory.js';

// Isolated replay based on the held 22 November Alamedin proposal and official
// EBRD 56011/ADB 59196-001 records. No production DB, network, SMTP or X.
const id='v3-test-alamedin-no-send';
const ebrd='https://www.ebrd.com/home/work-with-us/projects/psd/56011.html';
const adb='https://www.adb.org/projects/59196-001/main';
const ebrdText='Project ID 56011. Status Approved. Approval Date 18 Nov 2026. The project provides a sovereign loan of up to EUR 11 million to finance a 20 MW solar power plant with a 6 MWh battery energy storage system and transmission infrastructure at the Alamedin hydropower cascade.';
const adbText='Project number 59196-001. Project Status Proposed. The project will finance the construction of a 15 MWac floating solar photovoltaic plant on the HPP5 reservoir near Bishkek.';
const originalText='Alamedin, Kyrgyzstan: EBRD approved 20 MW solar and 6 MWh storage; ADB lists 15 MWac floating solar at HPP-5. Co-location could reuse hydro grid access and ease hydrology risk. Floating solar is proposed; EBRD approval is not a signed loan; main works remain unawarded.';

test('held Alamedin X draft can be rechecked using official source passages without publishing',async()=>{
 const adapter=new MemoryAdapter();
 const store=new CampaignStore(adapter);
 const asset={campaign_id:id,destination_id:'x',kind:'X',subject:'Alamedin hydro cascade adds solar-and-storage plans',body:originalText,
  story_record_id:'kyrgyz-hydro-solar-storage-hybrid-2026',review_status:'READY',evidence_ids:['kyrgyz:0','kyrgyz:1'],
  visual_url:'https://example.org/existing-evidence-graphic.png'};
 const evidence=[{id:'kyrgyz:0',verified:true,source_url:ebrd,fact:'EBRD approved 20 MW solar and 6 MWh BESS at Alamedin.'},
  {id:'kyrgyz:1',verified:true,source_url:adb,fact:'ADB lists a proposed 15 MWac floating solar project at HPP5.'}];
 const dest={id:'x',name:'X'};
 const binding=proposalBinding({asset,destination:dest,evidence});
 const state={id,phase:'PUBLICATION_REVIEW',assets:{x:{asset,fingerprint:assetFingerprint(asset)}},
  destinations:[dest],preparation_input:{document:{evidence}},
  editorial_preparation:{outcomes:{x:{...binding,status:'INVESTIGATION_REQUIRED',reason:'Primary source passages unavailable'}}},
  decisions:{},deliveries:{},events:[],email_groups:{},group_approvals:{},proposal_verifications:{}};
 await adapter.compareAndSwap(id,null,state);
 const seen=[],read=[];
 const assess=async input=>{
  seen.push({stage:input.stage,googleFeedback:input.googleFeedback,proposal:input.proposal});
  if(input.stage==='CORRECT')return {revision:null,status:'VERIFIED',deliverable:true};
  return {status:'VERIFIED',deliverable:true,fit:{x:true},contradictions:[],revision:null,
   explanation:'Both project records are attributable; the grid relationship is explicitly conditional.',
   claims:[
    {material:true,text:'EBRD status and project scope',status:'VERIFIED',passages:[{url:ebrd,quote:'Status Approved. Approval Date 18 Nov 2026.'},{url:ebrd,quote:'20 MW solar power plant with a 6 MWh battery energy storage system'}]},
    {material:true,text:'ADB proposal status and capacity',status:'VERIFIED',passages:[{url:adb,quote:'Project Status Proposed. The project will finance the construction of a 15 MWac floating solar photovoltaic plant'}]}
   ]};
 };
 const outputs=await prepareEditorialReview({
  store,campaignId:id,ids:['x'],forceRecheck:true,
  googleFeedback:{x:{verdict:'INVESTIGATE',reason:'Verify EBRD and ADB project records',correction:'Qualify financing and proposal statuses'}},
  readSource:async url=>{read.push(url);return {url,text:url===ebrd?ebrdText:adbText,page_sha256:'a'.repeat(64)};},
  assess,renderRevision:async()=>{throw Error('Existing visual must not rerender for unchanged text');}
 });
 const after=(await adapter.read(id)).value;
 assert.deepEqual(seen.map(x=>x.stage),['CORRECT','CHECK']);
 assert.equal(seen[0].googleFeedback[0].verdict,'INVESTIGATE');
 assert.deepEqual(new Set(read),new Set([ebrd,adb]));
 assert.equal(outputs.x,'READY_VERIFIED');
 assert.equal(after.assets.x.fingerprint,assetFingerprint(asset));
 assert.equal(after.assets.x.asset.body,originalText);
 assert.equal(after.editorial_preparation.outcomes.x.status,'READY_VERIFIED');
 assert.equal(after.editorial_preparation.outcomes.x.sources.length,3);
 assert.deepEqual(after.decisions,{});
 assert.deepEqual(after.deliveries,{});
});

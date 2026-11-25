import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';

test('opening the existing owner review refreshes a stale X visual before returning the saved entry',async()=>{
 let refreshCount=0;
 const asset={campaign_id:'campaign',destination_id:'x',kind:'X',subject:'Market formation',body:'Verified X draft',visual_url:'data:image/png;base64,old',visual_brand_version:'emradar-formation-card-v4'};
 const campaign={id:'campaign',phase:'PUBLICATION_REVIEW',destinations:[{id:'x'}],assets:{x:{asset,fingerprint:'older'}},decisions:{},deliveries:{},email_groups:{},editorial_preparation:null};
 const adapter={read:async()=>({value:structuredClone(campaign)}),compareAndSwap:async()=>true};
 const workflow=new ReviewWorkflow({store:{adapter},adapter,notify:async()=>({accepted:true}),baseUrl:'https://review.example',refreshXVisual:async id=>{
  assert.equal(id,'campaign');refreshCount++;
  campaign.assets.x.asset.visual_brand_version='emradar-formation-card-v5';
  campaign.assets.x.asset.visual_url='data:image/png;base64,new';
  campaign.assets.x.fingerprint='newer';
 }});
 workflow.authenticate=async()=>true;
 const view=await workflow.view('campaign','session','secret');
 assert.equal(refreshCount,1);
 assert.equal(view.entries[0].asset.visual_brand_version,'emradar-formation-card-v5');
 assert.equal(view.entries[0].asset.visual_url,'data:image/png;base64,new');
});

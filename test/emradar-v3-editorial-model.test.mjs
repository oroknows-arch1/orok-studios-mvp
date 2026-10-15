import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiPreparationProviders,correspondenceType} from '../vendor/emradar-v3/src/openai-preparation-providers.js';

const evidence={id:'e1',verified:true,fact:'Equipment investment, packaging partnerships, supplier development and workforce capacity are appearing together.',source:'Published scan',source_url:'https://source.example/fact'};
const sfy={subject:'India semiconductor ecosystem beyond fabs',introduction:"I'm Sean Walker, working on EMRADAR, where we track emerging market formations from evidence in the real economy.",observation:'Equipment investment, packaging partnerships, supplier development and workforce capacity are beginning to appear together.',significance:'The development matters because the less-visible ecosystem around fabrication may determine how much capacity becomes commercially useful.',contribution:'I am developing an evidence-backed contribution for Semiconductor For You on equipment, materials, packaging, testing, facility systems, suppliers and skills.',question:'Would this be suitable as an article or research contribution for Semiconductor For You?',limitations:'Commercial utilisation and supplier economics remain unresolved.'};
const openaiFor=value=>({chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})}},images:{generate:async()=>{throw Error('NOT_USED');}}});

test('approved SFY behaviour produces destination-specific connected-Earth editorial correspondence',async()=>{
 const providers=createOpenAiPreparationProviders({openai:openaiFor(sfy)});
 const asset=await providers.write({campaignId:'campaign',destination:{id:'sfy',name:'Semiconductor For You',category:'Publication',contact_verified:false,delivery_eligible:false,evidence:{ids:['e1']}},document:{evidence:[evidence],uncertainty:['Commercial utilisation remains unresolved.']}});
 assert.equal(asset.correspondence_type,'EDITORIAL_OUTREACH');
 assert.match(asset.body,/I'm Sean Walker/);assert.match(asset.body,/What|development matters/);assert.match(asset.body,/Semiconductor For You/);assert.match(asset.body,/Would this be suitable as an article or research contribution/);
 assert.match(asset.body,/Sean Walker\nEMRADAR \| Research & Editorial/);assert.equal(asset.brand_version,'connected-earth-v1');assert.equal(asset.visual,'CONNECTED_EARTH');assert.match(asset.html,/connected-earth-email-v1\.jpg/);assert.equal(asset.delivery_eligible,false);assert.equal(asset.to,null);assert.deepEqual(asset.evidence_ids,['e1']);
});

test('institutions are source enquiries, never editorial outreach',async()=>{
 assert.equal(correspondenceType({category:'International Finance'}),'SOURCE_ENQUIRY');
 const providers=createOpenAiPreparationProviders({openai:openaiFor({subject:'Evidence question',body:'Could you confirm whether the reported financing has reached financial close?'})});
 const asset=await providers.write({campaignId:'campaign',destination:{id:'bank',name:'World Bank',category:'International Finance',contact_verified:false,delivery_eligible:false,evidence:{ids:['e1']}},document:{evidence:[evidence]}});
 assert.equal(asset.correspondence_type,'SOURCE_ENQUIRY');assert.doesNotMatch(asset.body,/article|research contribution/i);assert.equal(asset.delivery_eligible,false);
});

test('editorial style remains an owner decision without bypassing required evidence',async()=>{
 const {createOpenAiPreparationProviders}=await import('../vendor/emradar-v3/src/openai-preparation-providers.js');
 const draft={subject:'Research contribution',introduction:'Sean Walker at EMRADAR.',observation:'Evidence shows a change. '.repeat(45),significance:'This may affect refining.',contribution:'A research contribution for Journal.',question:'Would you like to review it?',limitations:'Commercial utilisation is uncertain.'};
 const providers=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify(draft)}}]})}},images:{generate:async()=>{}}}});
 const destination={id:'journal',name:'Journal',destination_class:'EDITORIAL_PUBLICATION',evidence:{ids:['e1']},contact_verified:false,delivery_eligible:false};
 const asset=await providers.write({campaignId:'campaign',destination,document:{evidence:[{id:'e1',verified:true,fact:'Published fact'}]}});
 assert.equal(asset.kind,'EMAIL');assert.equal(asset.delivery_eligible,false);assert.equal(asset.to,null);assert.match(asset.body,/Would you like to review it/);
 await assert.rejects(providers.write({campaignId:'campaign',destination,document:{evidence:[]}}),/V3_DESTINATION_EVIDENCE_REQUIRED/);
});

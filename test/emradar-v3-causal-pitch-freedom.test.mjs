import test from 'node:test';
import assert from 'node:assert/strict';
import verifiedRecipient from './fixtures/v3-verified-recipient.cjs';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {isEditorialReady} from '../vendor/emradar-v3/src/editorial-preparation.js';

const evidence={id:'housing:source',record_id:'housing',verified:true,fact:'New housing finance programme announced',source_url:'https://example.org/official',source:'Development bank'};
const record={id:'housing',status:'FORMING',location:'Bangladesh',theme:'Resilient housing finance',causal_chain:{world_change:'Finance announced',pressure:'Climate resilience',bottleneck_or_scarcity:'Affordable household repayments',formation:'Household scale housing finance',consequences:'Uptake depends on loan economics'},what_to_check_next:'Compare loan and building cost assumptions',missing_evidence:['Repayment affordability']};
const body='Can a new housing finance programme bridge the gap between the cost of resilient construction and what households can repay? The question is not whether a programme was announced, but whether its loan terms can scale without excluding the families who need it. The programme announcement does not establish loans reaching households. I can prepare a sourced article examining this affordability test.';

test('question-led article pitch preserves causal bottleneck and uses one writer call without rigid repair',async()=>{
 const calls=[];
 const openai={chat:{completions:{create:async request=>{calls.push(request);return {choices:[{message:{content:JSON.stringify({subject:'Can housing loans meet construction costs?',body,analytical_finding:'The question is not whether a programme was announced, but whether its loan terms can scale without excluding the families who need it.',limitations:'The programme announcement does not establish loans reaching households.',story_evidence_ids:[evidence.id]})}}]};}}}};
 const providers=createOpenAiPreparationProviders({openai});
 const asset=await providers.write({campaignId:'campaign',destination:verifiedRecipient('housing-news',[evidence]),document:{evidence:[evidence],records:[record]}});
 assert.equal(calls.length,1);
 const payload=JSON.parse(calls[0].messages[1].content);
 assert.equal(payload.analysis_context.causal_chain.bottleneck_or_scarcity,'Affordable household repayments');
 assert.equal(payload.analysis_context.what_to_check_next,'Compare loan and building cost assumptions');
 assert.match(asset.body,/Can a new housing finance programme/);
 assert.doesNotMatch(asset.body,/Our latest scan identified a development worth examining/);
});

test('editorial investigation is advisory and cannot veto an otherwise reviewable owner draft',()=>{
 assert.equal(isEditorialReady('INVESTIGATION_REQUIRED'),true);
 assert.equal(isEditorialReady('READY_VERIFIED'),true);
 assert.equal(isEditorialReady('CORRECTED_READY'),true);
});

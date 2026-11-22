import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiPreparationProviders} from '../src/openai-preparation-providers.js';

function providerCapture(){
 const calls=[];
 const openai={chat:{completions:{create:async input=>{
  calls.push(input);
  return {choices:[{message:{content:JSON.stringify({status:'INVESTIGATION_REQUIRED',deliverable:false,
   fit:{outlet:false},claims:[],contradictions:[],revision:null,explanation:'No passages'})}}]};
 }}}};
 return {calls,provider:createOpenAiPreparationProviders({openai})};
}
const draft={kind:'EMAIL',subject:'A proposed investment and an open question',body:'The approval is proposed. Whether it proceeds remains unknown.'};
const context={proposal:draft,destinations:[{id:'outlet',name:'Example Publication'}],pages:[],previous:[]};
test('upstream CORRECT instruction demands supported factual premises and visible qualifications',async()=>{
 const {calls,provider}=providerCapture();
 await provider.assessEditorial({...context,stage:'CORRECT'});
 const system=calls[0].messages[0].content;
 assert.match(system,/UPSTREAM CLAIM REPAIR/);
 assert.match(system,/actual recipient-facing body/);
 assert.match(system,/remove the assertion/);
 assert.match(system,/do not offer an article claiming findings/i);
});
test('final CHECK tests EMRADAR story and deliverable promise while preserving qualified uncertainties',async()=>{
 const {calls,provider}=providerCapture();
 await provider.assessEditorial({...context,stage:'CHECK'});
 const system=calls[0].messages[0].content;
 assert.match(system,/FINAL STORY AND PROMISE/);
 assert.match(system,/outlet fit is genuine/);
 assert.match(system,/clearly framed uncertainties are legitimate article questions/);
 assert.match(system,/article promise is deliverable/);
 assert.match(system,/unsupported factual assertion/);
});

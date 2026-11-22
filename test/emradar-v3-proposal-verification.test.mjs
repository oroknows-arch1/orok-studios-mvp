import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';

test('final check receives exact proposal and fetched passages without a paid search or earlier wording',async()=>{
 const requests=[];
 const result={status:'VERIFIED',deliverable:true,fit:{journal:true},claims:[],revision:null};
 const providers=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async request=>{
  requests.push(request);
  return {choices:[{message:{content:JSON.stringify(result)}}]};
 }}}}});
 const proposal={kind:'EMAIL',subject:'Exact subject',body:'Exact saved body'};
 const pages=[{url:'https://example.org/source',text:'Full primary announcement'}];
 assert.deepEqual(await providers.assessEditorial({stage:'CHECK',proposal,pages,destinations:[{id:'journal'}],previous:[{claims:['Old wording']}]}),result);
 assert.deepEqual(JSON.parse(requests[0].messages[1].content),{proposal,pages,destinations:[{id:'journal'}]});
 assert.equal(requests[0].tools,undefined);
});

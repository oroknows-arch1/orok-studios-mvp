import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiEditorialRequest} from '../src/gemini-editorial-transport.js';

test('one Google request sends schema and search tool, parses all proposals',async()=>{
 let calls=0;
 const fetchImpl=async (url,init)=>{
  calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(init.headers['x-goog-api-key'],'TEST_ONLY_KEY');
  assert.equal(JSON.parse(init.body).tools[0].type,'google_search');
  assert.equal(JSON.parse(init.body).store,false);
  return {ok:true,json:async()=>({status:'completed',steps:[{type:'model_output',
   content:[{type:'text',text:JSON.stringify({proposals:[{id:'1',verdict:'READY',reason:'Supported',correction:'',sourceUrls:[]}]})}]}]})};
 };
 const request=createGeminiEditorialRequest({apiKey:'TEST_ONLY_KEY',fetchImpl});
 const result=await request({model:'example',tools:[{type:'google_search'}],store:false});
 assert.equal(calls,1);assert.equal(result.proposals[0].verdict,'READY');
});
test('missing credentials cannot silently activate external provider',()=>{
 assert.throws(()=>createGeminiEditorialRequest({apiKey:''}),/GEMINI_API_KEY_REQUIRED/);
});
test('provider HTTP errors and incomplete results are surfaced',async()=>{
 const badHttp=createGeminiEditorialRequest({apiKey:'TEST_ONLY_KEY',fetchImpl:async()=>({ok:false,status:429})});
 await assert.rejects(()=>badHttp({}),/GEMINI_AUDIT_HTTP_429/);
 const incomplete=createGeminiEditorialRequest({apiKey:'TEST_ONLY_KEY',fetchImpl:async()=>({ok:true,json:async()=>({status:'in_progress'})})});
 await assert.rejects(()=>incomplete({}),/GEMINI_AUDIT_NOT_COMPLETED/);
});
test('invalid Google output is rejected, not treated as approval',async()=>{
 const request=createGeminiEditorialRequest({apiKey:'TEST_ONLY_KEY',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'not json'}]}]})})});
 await assert.rejects(()=>request({}),/GEMINI_AUDIT_INVALID_JSON/);
});

const test=require('node:test');const assert=require('node:assert/strict');
const {createHarnessRelay,exchange}=require('../src/emradar-harness');
const rates=async()=>({ok:true,url:'https://www.rba.gov.au/statistics/frequency/exchange-rates.html',text:async()=>'<th>02 Oct 2026</th><tr><td>United States dollar</td><td>0.6933</td></tr>'});
const env={OPENAI_API_KEY:'TEST_ONLY',EMRADAR_EMAIL_RELAY_TOKEN:'TEST_ONLY'};
async function call(handler,operation,body={},token='TEST_ONLY') {let output,status=200;const res={status(n){status=n;return this;},json(v){output=v;return this;}};await handler({params:{operation},headers:{authorization:'Bearer '+token},body},res);return {status,output};}
test('authenticated quote bounds two provider calls; execute and independent verification are idempotent',async()=>{
 let calls=0;const openai={chat:{completions:{create:async(input,options)=>{assert.equal(options.maxRetries,0);assert.ok(input.max_completion_tokens<=5000);calls++;return {id:'request-'+calls,model:input.model,usage:{prompt_tokens:100,completion_tokens:50,prompt_tokens_details:{cached_tokens:10}},choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls===1?{body:'Source-bound draft',evidence_refs:['E1']}:{editorial_checks:Object.fromEntries(['factual_entailment','uncertainty_preserved','destination_fit','originality','capability_inventory','human_correspondence'].map(k=>[k,'PASS']))})}}]};}}}};
 const h=createHarnessRelay({openai,env,fetcher:rates}),unit={workUnitId:'EMRADAR:editorial_intelligence'},context={source:{state:'CONFIRMED'}};
 assert.equal((await call(h,'quote',{unit,context},'WRONG')).status,403);assert.equal(calls,0);
 const {output:quote}=await call(h,'quote',{unit,context});assert.ok(quote.max_cost_aud>0&&quote.max_cost_aud<.2);assert.ok(quote.signature);
 const input={unit,decision:{providerId:'openai',modelId:'terra'},context:{...context,input_hash:'input-hash',cost_reservation:{quote}}};
 const executed=await call(h,'execute',input);assert.equal(executed.status,200);assert.equal(executed.output.billing.actual,false);assert.equal(executed.output.billing.usage.cached_input_tokens,10);
 await call(h,'execute',input);assert.equal(calls,1);
 const verified=await call(h,'verify',{...input,result:executed.output.result});assert.equal(verified.output.status,'VERIFIED');assert.equal(calls,2);
 const altered=structuredClone(input);altered.context.source.state='UNKNOWN';assert.equal((await call(h,'execute',altered)).status,409);assert.equal(calls,2);
});
test('source-bound producer schema is enforced at generation, independent verifier is unchanged',async()=>{
 const formats=[],openai={chat:{completions:{create:async(input)=>{formats.push(input.response_format);return {id:'schema-'+formats.length,usage:{prompt_tokens:20,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(formats.length===1?{body:'Draft',evidence_refs:['E1']}:{editorial_checks:{}})}}]};}}}};
 const h=createHarnessRelay({openai,env,fetcher:rates}),unit={workUnitId:'EMRADAR:editorial_intelligence'},schema={type:'object',properties:{body:{type:'string',description:'Natural proposition, at most 75 words.'}},required:['body'],additionalProperties:false},context={source:{state:'CONFIRMED'},response_schema:schema};
 const {output:quote}=await call(h,'quote',{unit,context}),input={unit,decision:{providerId:'openai',modelId:'terra'},context:{...context,input_hash:'bound',cost_reservation:{quote}}};
 const execution=await call(h,'execute',input);assert.equal(execution.status,200);assert.deepEqual(formats[0],{type:'json_schema',json_schema:{name:'emradar_editorial_correspondence',strict:true,schema}});
 await call(h,'verify',{...input,result:execution.output.result});assert.equal(formats[1].type,'json_schema');assert.equal(formats[1].json_schema.name,'emradar_editorial_verification');assert.equal(formats[1].json_schema.strict,true);assert.deepEqual(formats[1].json_schema.schema.properties.editorial_checks.required,['factual_entailment','uncertainty_preserved','destination_fit','originality','capability_inventory','human_correspondence']);
 const changed=structuredClone(input);changed.context.response_schema.required=[];assert.equal((await call(h,'execute',changed)).status,409);assert.equal(formats.length,2);
});
test('unknown exchange rate blocks before paid work',async()=>{await assert.rejects(exchange(async()=>({ok:true,text:async()=>'<html>unavailable</html>'})),/UNVERIFIED/);});

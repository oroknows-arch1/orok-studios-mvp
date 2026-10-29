'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createGrokAudiencePilot,validate}=require('../src/emradar-grok-audience-pilot.cjs');
const {createFullScanResearch,parseResearch}=require('../src/emradar-grok-full-scan.cjs');
function response(input,{cost=10000000,cited=true}={}){
 const id=input.discovery.record_id,url='https://x.com/researcher/status/987';
 const report={discovery_id:id,keywords:['grid'],alternative_phrases:['power bottleneck'],topic_clusters:['infrastructure'],opportunities:[{type:'REPLY',url,rationale:'Direct discussion of the evidenced constraint.',evidence_ids:[id+':0'],draft_text:'Which evidence would distinguish these competing explanations?',scores:{relevance:5,credibility:4,recency:3,engagement:2,fit:5}}]};
 return {model:'test-grok',report:{status:'completed',id:'response-'+id,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(report),annotations:cited?[{type:'url_citation',url}]:[]}]}],usage:{total_tokens:100,cost_in_usd_ticks:cost,server_side_tool_usage_details:{x_search_calls:1,x_posts_fetched:1,x_users_fetched:0}}}};
}
function fixture(pilot){
 const document={publication_state:'PUBLISHED',snapshot_date:'2026-10-17',records:[{id:'a',evidence:[{url:'https://example.org/a',fact:'Observed constraint'}]},{id:'b',evidence:[{url:'https://example.org/b',fact:'Unconfirmed formation'}]}]};
 const bytes=Buffer.from(JSON.stringify(document)),source_sha256=createHash('sha256').update(bytes).digest('hex');
 const segments=[{sequence:1,kind:'SUMMARY',text:'Scan',asset_sha256:'h1'},{sequence:2,kind:'DISCOVERY',asset_sha256:'h2'},{sequence:3,kind:'DISCOVERY',asset_sha256:'h3'}];
 const state={audience_x_review:{source_sha256,manifest_sha256:'manifest',discovery_ids:['a','b'],segments,scan:{snapshot_date:'2026-10-17'}},audience_x_publication:{status:'COMPLETE',manifest_sha256:'manifest',posts:[{post_id:'100'},{post_id:'101'},{post_id:'102'}]}};
 const data=new Map([['c',{value:state,version:1}]]),adapter={read:async key=>structuredClone(data.get(key)),compareAndSwap:async(key,version,value)=>{if((data.get(key)?.version??null)!==version)return false;data.set(key,{version:(version??0)+1,value:structuredClone(value)});return true}};
 const store={adapter,mutate:async(key,fn)=>{const old=data.get(key),next=fn(structuredClone(old.value));data.set(key,{version:old.version+1,value:next});return next}};
 const rows=segments.map((s,i)=>({status:'ACCEPTED',sequence:s.sequence,receipt_id:String(100+i),approved_asset_sha256:s.asset_sha256}));
 const options={store,pilot,loadPublishedBytes:async()=>bytes,loadPublicationRows:async()=>rows,enabled:true,maxSpendUsd:1,requestReserveUsd:0.1,providerSpendLimitVerified:true,maxRequestsPerBatch:1};
 return {data,state,rows,options,run:createFullScanResearch(options)};
}
test('Responses API contract accepts real numeric IDs and bounds hosted X Search',async()=>{
 assert.equal(validate({post_id:'123',body:'Exact post',evidence:[]}).post_id,'123');
 let request;
 const pilot=createGrokAudiencePilot({enabled:true,apiKey:'test-only',model:'grok-test',fetcher:async(url,options)=>{request={url,...JSON.parse(options.body)};return {ok:true,json:async()=>({status:'completed',id:'r'})}}});
 await pilot.research({post_id:'123',body:'Exact post',evidence:[],discovery:{record_id:'a'}});
 assert.equal(request.url,'https://api.x.ai/v1/responses');assert.deepEqual(request.tools,[{type:'x_search'}]);assert.equal(request.max_turns,1);assert.equal(request.max_output_tokens,1800);assert.equal(request.store,false);
});
test('every discovery is researched once across bounded durable checkpoints',async()=>{
 const inputs=[],f=fixture({research:async input=>{inputs.push(input);return response(input)}});
 assert.equal((await f.run('c')).covered,1);assert.equal((await f.run('c')).status,'COMPLETE');
 assert.deepEqual(inputs.map(i=>i.discovery.record_id),['a','b']);assert.equal(inputs[1].discovery.record.evidence[0].fact,'Unconfirmed formation');
 assert.equal((await f.run('c')).outbound_actions,0);assert.equal(inputs.length,2);
 assert.equal(f.data.get('c').value.audience_x_research.cost_ticks,20000000);
});
test('provider spending gate and publication completeness block all API calls',async()=>{
 let calls=0;const f=fixture({research:async()=>{calls++;throw Error('must not run')}});
 await assert.rejects(()=>createFullScanResearch({...f.options,providerSpendLimitVerified:false})('c'),/PROVIDER_SPEND_LIMIT_REQUIRED/);
 f.rows[1].status='AMBIGUOUS';await assert.rejects(()=>f.run('c'),/CONFIRMED_FULL_THREAD_REQUIRED/);assert.equal(calls,0);
});
test('unconfirmed charged failures never retry and preserve reserved budget',async()=>{
 let calls=0;const f=fixture({research:async()=>{calls++;throw Error('timeout')}});
 await f.run('c');await f.run('c');await f.run('c');
 assert.equal(calls,2);assert.equal(f.data.get('c').value.audience_x_research.results.a.status,'HALTED_UNCONFIRMED');
 assert.equal(f.data.get('c').value.audience_x_research.reserved_ticks,2000000000);
});
test('rate limiting persists backoff, bounded attempts and no immediate retry',async()=>{
 let calls=0;const f=fixture({research:async()=>{calls++;throw Object.assign(Error('GROK_RATE_LIMITED'),{retry_after_ms:60000})}});
 const fixed=()=>100000,run=createFullScanResearch({...f.options,clock:fixed});
 await run('c');await run('c');await run('c');assert.equal(calls,2);
 assert.equal(f.data.get('c').value.audience_x_research.results.a.retry_at,160000);
});
test('missing citations, wrong discoveries and missing cost receipts cannot become research evidence',()=>{
 const d={record_id:'a',record_sha256:'sha',record:{evidence:[{}]}};
 assert.throws(()=>parseResearch(response({discovery:{record_id:'a'}},{cited:false}),d),/UNCITED/);
 assert.throws(()=>parseResearch(response({discovery:{record_id:'other'}}),d),/COVERAGE_MISMATCH/);
 const missing=response({discovery:{record_id:'a'}});delete missing.report.usage;assert.throws(()=>parseResearch(missing,d),/COST_RECEIPT_REQUIRED/);
});
test('spending and request limits stop the batch without claiming uncovered discoveries',async()=>{
 let calls=0;const f=fixture({research:async input=>{calls++;return response(input,{cost:9500000000})}});
 await f.run('c');assert.equal((await f.run('c')).status,'BUDGET_EXHAUSTED');assert.equal(calls,1);assert.equal(f.data.get('c').value.audience_x_research.results.b,undefined);
});
test('unchanged discovery research is reused across campaigns without duplicate API spend',async()=>{
 let calls=0;const f=fixture({research:async input=>{calls++;return response(input)}});
 await f.run('c');await f.run('c');assert.equal(calls,2);
 const prior=f.data.get('c');const next=structuredClone(prior.value);delete next.audience_x_research;f.data.set('other',{value:next,version:1});
 await f.run('other');assert.equal((await f.run('other')).status,'COMPLETE');assert.equal(calls,2);
 assert.equal(f.data.get('other').value.audience_x_research.requests,0);
});
test('invalid results retain actual billed usage without accepting uncited opportunities',async()=>{
 const f=fixture({research:async input=>response(input,{cited:false})});await f.run('c');
 const job=f.data.get('c').value.audience_x_research;assert.equal(job.cost_ticks,10000000);assert.equal(job.reserved_ticks,0);assert.equal(job.results.a.status,'HALTED_UNCONFIRMED');assert.equal(job.opportunities.length,0);
 const d={record_id:'a',record_sha256:'sha',record:{evidence:[{}]}},r=response({discovery:{record_id:'a'}});delete r.report.usage.server_side_tool_usage_details;assert.throws(()=>parseResearch(r,d),/SEARCH_PROVENANCE_REQUIRED/);
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const {createHash}=require('node:crypto');
const load=()=>import(pathToFileURL(resolve(__dirname,'../vendor/emradar-v3/src/autonomous-outlet-discovery.js')).href);
const document={records:[{id:'r1',status:'FORMING',location:'Chile',causal_chain:{world_change:'Copper supply change',formation:'Mining investment formation',industries:['Copper mining'],pressures:['Supply pressure'],bottleneck_or_scarcity:['Ore scarcity'],consequences:['Investment changes']}}],evidence:[{id:'e1',record_id:'r1',verified:true,fact:'Verified copper supply change',source_url:'https://source.example/fact'}]};
function harness(candidates,html='Contact our editorial newsroom at editor@journal.example'){
 const saved=[];
 candidates=candidates.map(item=>({publication_type:'trade_publication',publication_proof_url:item.website+'/news',formation_ids:['r1'],industries:['Copper mining'],ecosystem_formation_ids:['r1'],relationship_reason:'Covers the affected copper mining industry.',...item}));
 const openai={responses:{create:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({candidates})}]}]})}};
 const fetcher=async()=>({ok:true,headers:{get:()=> 'text/html'},text:async()=>html});
 const resolver=async()=>[{address:'8.8.8.8'}];
 return {saved,openai,fetcher,resolver,contactReader:async()=>html,directory:{upsert:async r=>{const index=saved.findIndex(item=>item.id===r.id);if(index===-1)saved.push(r);else saved[index]=r;}}};
}
test('evidence-backed publication contact is persisted and linked',async()=>{
 const h=harness([{name:'Journal',category:'mining journal',website:'https://journal.example',contact_url:'https://journal.example/editorial',email:'editor@journal.example',evidence_ids:['e1']}]);
 const {createAutonomousOutletDiscovery}=await load();
 const links=await createAutonomousOutletDiscovery(h)({document});
 assert.equal(h.saved.length,1);assert.equal(h.saved[0].contact_verified,true);
 assert.equal(links.length,1);assert.equal(links[0].record_id,'r1');
});
test('rejects private IP hosts and non-editorial contacts',async()=>{
 const candidates=[
 {name:'Private',category:'mining journal',website:'https://127.0.0.1',contact_url:'https://127.0.0.1/contact',email:'editor@journal.example',evidence_ids:['e1']},
 {name:'Journal',category:'mining journal',website:'https://journal.example',contact_url:'https://journal.example/contact',email:'editor@journal.example',evidence_ids:['e1']}];
 const h=harness(candidates,'News and analysis. Sales team editor@journal.example');const {createAutonomousOutletDiscovery}=await load();
 assert.equal((await createAutonomousOutletDiscovery(h)({document})).length,1);assert.equal(h.saved.length,1);assert.equal(h.saved[0].contact_verified,false);assert.equal(h.saved[0].editorial_fit_verified,true);
});
test('does not trust model-invented evidence IDs',async()=>{
 const h=harness([{name:'Journal',category:'mining journal',website:'https://journal.example',contact_url:'https://journal.example/contact',email:'editor@journal.example',evidence_ids:['not-in-scan']}]);
 const {createAutonomousOutletDiscovery}=await load();assert.deepEqual(await createAutonomousOutletDiscovery(h)({document}),[]);
});
test('rejects non-public DNS resolution',async()=>{
 const h=harness([{name:'Journal',category:'mining journal',website:'https://journal.example',contact_url:'https://journal.example/contact',email:'editor@journal.example',evidence_ids:['e1']}]);
 h.resolver=async()=>[{address:'10.0.0.2'}];const {createAutonomousOutletDiscovery}=await load();
 assert.deepEqual(await createAutonomousOutletDiscovery(h)({document}),[]);assert.equal(h.saved.length,0);
});

test('directory selection preserves individual scan evidence links',async()=>{
 const {createDirectoryDiscovery}=await import(pathToFileURL(resolve(__dirname,'../vendor/emradar-v3/src/directory-discovery.js')).href);
 const h=harness([{name:'Journal',category:'mining journal',website:'https://journal.example',contact_url:'https://journal.example/editorial',email:'editor@journal.example',evidence_ids:['e1']}]);
 const {createAutonomousOutletDiscovery}=await load();
 const directory={list:async()=>h.saved};
 const discover=createDirectoryDiscovery({directory,linkEvidence:createAutonomousOutletDiscovery(h)});
 const selected=await discover({scan:{},document,history:[]});
 assert.ok(selected.some(d=>d.id===h.saved[0].id));
});

test('reuses already verified evidence-linked outlet without paid search',async()=>{
 const h=harness([]);
 h.openai.responses.create=async()=>{throw Error('SEARCH_MUST_NOT_RUN')};
 const existing={id:'existing-1',destination_class:'EDITORIAL_PUBLICATION',active:true,contact_verified:true,editorial_fit_verified:true,contact:{email:'editor@journal.example',source_url:'https://journal.example/editorial',checked_at:'2026-10-13'},verification:{evidence_ids:['e1'],scan_evidence_digest:createHash('sha256').update(JSON.stringify(document.evidence.map(e=>[e.id,e.fact,e.source_url]))).digest('hex')}};
 const {createAutonomousOutletDiscovery}=await load();
 const links=await createAutonomousOutletDiscovery(h)({document,outlets:[existing]});
 assert.equal(links.length,1);assert.equal(links[0].outlet_id,'existing-1');assert.equal(h.saved.length,0);
});

test('same evidence ID with changed facts cannot reuse prior scan links',async()=>{
 const h=harness([]);let searches=0;
 h.openai.responses.create=async()=>{searches++;return {output:[{content:[{type:'output_text',text:'{"candidates":[]}'}]}]}};
 const existing={id:'old',active:true,contact_verified:true,editorial_fit_verified:true,contact:{email:'editor@journal.example',source_url:'https://journal.example/editorial'},verification:{evidence_ids:['e1'],scan_evidence_digest:'outdated'}};
 const {createAutonomousOutletDiscovery}=await load();
 const links=await createAutonomousOutletDiscovery(h)({document,outlets:[existing]});
 assert.equal(searches,1);assert.deepEqual(links,[]);
});

test('rejects web-search responses without valid structured candidates and never writes',async()=>{
 const h=harness([]);
 h.openai.responses.create=async()=>({output:[{content:[{type:'output_text',text:'not JSON'}]}]});
 const {createAutonomousOutletDiscovery}=await load();
 const messages=[];const original=console.error;console.error=message=>messages.push(message);
 try{await assert.rejects(createAutonomousOutletDiscovery(h)({document}),/DISCOVERY_SEARCH_JSON_INVALID/);}
 finally{console.error=original;}
 assert.equal(h.saved.length,0);
 assert.equal(messages.length,1);
 assert.match(messages[0],/^V3_DISCOVERY_SEARCH_PARSE_DIAGNOSTIC /);
 assert.deepEqual(JSON.parse(messages[0].slice(messages[0].indexOf('{'))),{
  response_type:'object',top_level_keys:['output'],output_count:1,output_types:[null],content_counts:[1],content_types:[['output_text']],output_text_lengths:[[8]],parse_error_name:'SyntaxError'
 });
});
test('requires provider-enforced structured discovery output',async()=>{
 const h=harness([]);let request;
 h.openai.responses.create=async value=>{request=value;return {output:[{type:'message',content:[{type:'output_text',text:'{"candidates":[]}'}]}]}};
 const {createAutonomousOutletDiscovery}=await load();
 assert.deepEqual(await createAutonomousOutletDiscovery(h)({document}),[]);
 assert.equal(request.text.format.type,'json_schema');
 assert.equal(request.text.format.strict,true);
 assert.deepEqual(request.text.format.schema.required,['candidates']);
 assert.equal(request.text.format.schema.properties.candidates.maxItems,10);
 assert.equal(request.max_tool_calls,1);
 const brief=JSON.parse(request.input[1].content);
 assert.match(brief.search_brief,/Copper mining.*trade magazine/);
 assert.equal(brief.evidence[0].source_url,undefined);
 assert.equal(brief.connected_ecosystems[0].formation_id,'r1');
});
test('rejects unverified editorial email even when search suggests a matching address',async()=>{
 const h=harness([{name:'Journal',category:'mining journal',website:'https://journal.example',contact_url:'https://journal.example/editorial',email:'editor@journal.example',evidence_ids:['e1']}],'Editorial enquiries to another@journal.example');
 const {createAutonomousOutletDiscovery}=await load();
 assert.equal((await createAutonomousOutletDiscovery(h)({document})).length,1);
 assert.equal(h.saved.length,1);assert.equal(h.saved[0].contact_verified,false);assert.equal(h.saved[0].editorial_fit_verified,true);
});
test('rejects contact pages that redirect or return non-HTML in real reader',async()=>{
 const h=harness([{name:'Journal',category:'mining journal',website:'https://journal.example',contact_url:'https://journal.example/editorial',email:'editor@journal.example',evidence_ids:['e1']}]);
 let reads=0;h.contactReader=async()=>{if(reads++===0)return 'News and analysis';throw Error('CONTACT_RESPONSE_INVALID')};
 const {createAutonomousOutletDiscovery}=await load();
 assert.equal((await createAutonomousOutletDiscovery(h)({document})).length,1);
 assert.equal(h.saved.length,1);assert.equal(h.saved[0].contact_verified,false);assert.equal(h.saved[0].editorial_fit_verified,true);
});
test('rejects a scan source institution as a destination',async()=>{
 const h=harness([{name:'Source Institution',category:'research',website:'https://source.example',contact_url:'',email:'',evidence_ids:['e1']}],'News and analysis');
 const {createAutonomousOutletDiscovery}=await load();
 assert.deepEqual(await createAutonomousOutletDiscovery(h)({document}),[]);assert.equal(h.saved.length,0);
});
test('derives formation, industry and ecosystem context from verified records',async()=>{
 const {deriveDiscoveryContext}=await load();const context=deriveDiscoveryContext(document);
 assert.deepEqual(context.industries,['Copper mining']);assert.equal(context.formations[0].id,'r1');assert.equal(context.ecosystems[0].formation_id,'r1');
});

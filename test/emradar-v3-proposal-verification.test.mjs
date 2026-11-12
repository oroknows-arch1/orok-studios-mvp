import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';

const result={status:'VERIFIED',deliverable:true,claims:[{id:'claim-1',text:'A material claim',material:true,status:'VERIFIED',explanation:'Supported.',source_urls:['https://source.example/report']}],contradictions:[],sources:[{title:'Report',url:'https://source.example/report'}],revised_proposal:null,explanation:'Checked independently.'};
const response=value=>({output:[{type:'web_search_call',action:{sources:[{url:'https://source.example/report'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(value),annotations:[{type:'url_citation',url:'https://source.example/report'}]}]}]});
const input={asset:{kind:'EMAIL',destination_id:'journal',body:'Proposal',evidence_ids:['e1']},destination:{id:'journal'},evidence:[{id:'e1',fact:'Evidence',source_url:'https://evidence.example'}]};

test('proposal investigator requires genuine web search citations for every verified material claim',async()=>{
 const requests=[];const providers=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>({})}},responses:{create:async request=>{requests.push(request);return response(result);}}}});
 assert.deepEqual(await providers.investigateProposal(input),result);
 assert.equal(requests[0].tool_choice,'required');assert.equal(requests[0].tools[0].type,'web_search');
 const unsupported=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>({})}},responses:{create:async()=>response({...result,claims:[{...result.claims[0],source_urls:['https://invented.example']} ]})}}});
 await assert.rejects(unsupported.investigateProposal(input),/PROPOSAL_RESEARCH_SOURCES_UNVERIFIED/);
});

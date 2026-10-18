import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAutonomousOutletDiscovery} from '../vendor/emradar-v3/src/autonomous-outlet-discovery.js';
import {assessPublicationReview} from '../vendor/emradar-v3/src/preparation-review-service.js';

const evidence=[{id:'e1',record_id:'r1',verified:true,fact:'A verified copper project was proposed.',source_url:'https://source.example/fact'}];
const document={records:[{id:'r1',location:'Chile',causal_chain:{industries:['Copper mining'],pressures:['Supply pressure'],consequences:['Investment changes']}}],evidence};
const scanDigest=createHash('sha256').update(JSON.stringify(evidence.map(e=>[e.id,e.fact,e.source_url]))).digest('hex');
const candidate={name:'Copper Journal',category:'mining',publication_type:'trade_publication',website:'https://journal.example',publication_proof_url:'https://journal.example/news',contact_url:'https://journal.example/contact',email:'',directory_source_url:'',publisher_source_url:'',formation_ids:['r1'],industries:['Copper mining'],ecosystem_formation_ids:['r1'],evidence_ids:['e1'],relationship_reason:'Covers copper mining investment affected by the verified project formation.'};
const response=payload=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]});

test('publication proof persists without any email and contact remains independently unresolved',async()=>{
 const publications=[],research=[];
 const worker=createAutonomousOutletDiscovery({
  openai:{responses:{create:async request=>Array.isArray(request.input)?response({candidates:[candidate]}):response({urls:[]})}},
  directory:{list:async()=>publications,upsertPublication:async record=>publications.push(structuredClone(record)),upsert:async()=>{throw Error('CONTACT_MUST_NOT_VERIFY')},researchHistory:async()=>[],recordResearch:async record=>research.push(structuredClone(record))},
  resolver:async()=>[{address:'8.8.8.8'}],
  contactReader:async url=>url.pathname==='/news'?'<h1>Copper mining news and analysis</h1>':'<h1>Contact</h1><p>Advertising enquiries only</p>'
 });
 assert.deepEqual(await worker({document}),[]);
 assert.equal(publications.length,1);assert.equal(publications[0].publication_verified,true);assert.equal(publications[0].contact_verified,false);assert.equal(publications[0].contact,null);
 assert.equal(publications[0].verification.scan_evidence_digest,scanDigest);assert.deepEqual(publications[0].relationship.formation_ids,['r1']);assert.deepEqual(publications[0].relationship.industries,['Copper mining']);
 assert.equal(research[0].status,'PUBLICATION_VERIFIED_CONTACT_UNRESOLVED');assert.equal(research[0].reason,'NO_RELEVANT_PUBLISHED_CONTACT');assert(research[0].retry_eligible_at);
});

test('review reports publication and contact states independently and never requires an unaddressed draft',()=>{
 const unresolved={id:'unresolved',name:'Copper Journal',category:'mining',publication_type:'trade_publication',destination_class:'EDITORIAL_PUBLICATION',website:'https://journal.example',active:true,publication_verified:true,editorial_fit_verified:true,contact_verified:false,contact:null,relationship:{formation_ids:['r1'],industries:['Copper mining'],ecosystem_formation_ids:['r1'],reason:'Covers the verified copper investment formation.'},verification:{publication_method:'live_publication_page',publication_status:'VERIFIED',publication_proof_url:'https://journal.example/news',publication_page_sha256:'a'.repeat(64),evidence_ids:['e1'],scan_evidence_digest:scanDigest}};
 const state={phase:'PUBLICATION_REVIEW',preparation_input:{document},destinations:[{id:'x'}],assets:{x:{asset:{kind:'X',destination_id:'x',body:'Preserved X',visual_url:'saved-image'}}},decisions:{},deliveries:{}};
 assert.deepEqual(assessPublicationReview({state,candidates:[unresolved]}),{complete:false,verified_publications:1,verified_contacts:0,unresolved_contacts:1,editorial_emails:0,x_ready:true,missing_destination_ids:[]});
});

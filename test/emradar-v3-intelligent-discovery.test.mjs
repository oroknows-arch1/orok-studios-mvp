import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAutonomousOutletDiscovery} from '../vendor/emradar-v3/src/autonomous-outlet-discovery.js';
import {researchPublishedDirectory,createEditorialContactResearch,extractPublicationContacts} from '../vendor/emradar-v3/src/editorial-contact-research.js';
import {OutletDirectory} from '../vendor/emradar-v3/src/outlet-directory.js';
import policy from '../src/emradar-v3-recipient.cjs';
import verified from './fixtures/v3-verified-recipient.cjs';
const document={records:[{id:'r1',location:'Chile',theme:'Industrial investment',causal_chain:{industries:['Copper mining']}}],evidence:[{id:'e1',record_id:'r1',verified:true,fact:'A copper project was proposed.',source:'Government',source_url:'https://government.example/fact'}]};
const listing='<a href="/about">About us</a><article><h2>Mining Journal</h2><a href="https://journal.example">Mining Journal official website</a><p>Editorial desk: <a href="mailto:news@journal.example">Email</a></p><p>Advertising: sales@journal.example</p></article>';
const identity='<h1>About our Press Association</h1><p>We publish a public directory of newspapers and magazines.</p>';
const candidate=(name='Mining Journal',domain='journal.example')=>({name,category:'mining',publication_type:'trade_publication',website:'https://'+domain,publication_proof_url:'https://'+domain+'/news',contact_url:'https://'+domain+'/contact-us',directory_source_url:'',publisher_source_url:'',formation_ids:['r1'],industries:['Copper mining'],ecosystem_formation_ids:['r1'],evidence_ids:['e1'],relationship_reason:'Covers copper mining and project investment.'});
const response=payload=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]});
test('retrieved directory entry ties publication, official website, editorial role, exact email and identifiable source together',async()=>{
 const result=await researchPublishedDirectory({read:async url=>url.pathname==='/about'?identity:listing,url:'https://press.example/directory/journal',website:'https://journal.example',publication:'Mining Journal'});
 assert.equal(result.primary.email,'news@journal.example');assert.equal(result.source_kind,'published_editorial_directory');
 const d={...verified(),name:'Mining Journal',contact:result.primary,verification:{...verified().verification,method:result.source_kind,publication_proof_url:result.primary.source_url,publication_page_sha256:result.primary.page_sha256}};
 assert(policy.verifiedDestination(d));
 for(const change of [p=>p.contact.directory_attribution.publication_url='https://imposter.example',p=>p.contact.directory_attribution.identity_sha256=null,p=>p.contact.directory_attribution.entry_excerpt='Someone else news@journal.example',p=>p.verification.publication_proof_url='https://other.example/list']){
  const invalid=structuredClone(d);change(invalid);assert(!policy.verifiedDestination(invalid));
 }
});
test('a directory cannot borrow an editor from the next publication or an unverified identity page',async()=>{
 const wrong='<article><h2>Mining Journal</h2><a href="https://journal.example">Website</a></article><article><h2>Other Magazine</h2><a href="https://other.example">Website</a><p>Editor: other@other.example</p></article><a href="/about">About us</a>';
 await assert.rejects(researchPublishedDirectory({read:async()=>wrong,url:'https://press.example/directory',website:'https://journal.example',publication:'Mining Journal'}),/DIRECTORY_PUBLICATION_CONTACT_NOT_PROVEN/);
 await assert.rejects(researchPublishedDirectory({read:async url=>url.pathname==='/about'?'Access denied':listing,url:'https://press.example/directory',website:'https://journal.example',publication:'Mining Journal'}),/DIRECTORY_IDENTITY_NOT_PROVEN/);
});
test('each blocked candidate gets one fallback; indexed URLs are retrieved, successes persist and later failures are isolated',async()=>{
 const saved=[],history=[],calls=[],reads=[];
 const openai={responses:{create:async request=>{calls.push(request);if(Array.isArray(request.input))return response({candidates:[candidate(),candidate('Second Journal','second.example'),candidate('Third Journal','third.example')]});return {...response({urls:[]}),output:[{type:'web_search_call',action:{sources:[{url:'https://press.example/directory/journal'}]}},...response({urls:[]}).output]};}}};
 const directory={list:async()=>saved,upsert:async record=>saved.push(record),researchHistory:async()=>[],recordResearch:async record=>history.push(structuredClone(record))};
 const worker=createAutonomousOutletDiscovery({openai,directory,resolver:async()=>[{address:'8.8.8.8'}],contactReader:async url=>{reads.push(url.href);if(url.hostname==='press.example')return url.pathname==='/about'?identity:listing;throw Error('CONTACT_HTTP_403');}});
 const links=await worker({document});assert.equal(saved.length,1);assert.equal(saved[0].contact.email,'news@journal.example');assert.equal(links.length,1);assert.equal(history.length,3);assert.equal(history[0].status,'VERIFIED');assert.equal(history[1].status,'UNRESOLVED');assert.equal(history[2].status,'UNRESOLVED');assert.equal(calls.length,4);
 assert(history[1].failures.some(f=>f.reason==='CONTACT_HTTP_403'));assert(history[1].retry_eligible_at);assert.equal(new Set(reads).size,reads.length);
});
test('fallback search failure for one publication cannot stop a later verified publication',async()=>{
 const saved=[],history=[];let searches=0;
 const worker=createAutonomousOutletDiscovery({directory:{list:async()=>saved,upsert:async r=>saved.push(r),recordResearch:async r=>history.push(r)},resolver:async()=>[{address:'8.8.8.8'}],contactReader:async url=>{if(url.hostname==='journal.example')throw Error('CONTACT_HTTP_403');return '<h2>Editorial</h2><p>Editor: editor@next.example</p>';},openai:{responses:{create:async request=>{searches++;if(Array.isArray(request.input))return response({candidates:[candidate(),candidate('Next Journal','next.example')]});throw Error('PROVIDER_UNAVAILABLE');}}}});
 await worker({document});assert.equal(searches,2);assert.equal(saved.length,1);assert.equal(saved[0].name,'Next Journal');assert.equal(history.length,2);
});
test('recent verified contacts can be reused with new scan evidence without a website read or invented verification date',async()=>{
 const prior=verified('web-'+createHash('sha256').update('journal.example').digest('hex').slice(0,20),document.evidence);prior.name='Mining Journal';prior.contact.checked_at=new Date().toISOString();prior.verification.scan_evidence_digest='a'.repeat(64);
 const saved=[];await createAutonomousOutletDiscovery({directory:{list:async()=>[prior],upsert:async r=>saved.push(r)},openai:{responses:{create:async()=>response({candidates:[candidate()]})}},resolver:async()=>[{address:'8.8.8.8'}],contactReader:async()=>{throw Error('NO_REPEAT_READ');}})({document,outlets:[prior]});
 assert.equal(saved.length,1);assert.equal(saved[0].contact.checked_at,prior.contact.checked_at);assert.notEqual(saved[0].verification.scan_evidence_digest,prior.verification.scan_evidence_digest);
});
test('research history writes are separate from active directory writes and retain failure reasons and retry eligibility',async()=>{
 const sql=[];const directory=new OutletDirectory({query:async(query,args)=>{sql.push({query,args});return {rows:[],rowCount:1};}});
 await directory.initialize();await directory.recordResearch({publication:'Blocked Journal',website:'https://blocked.example',scan_digest:'a'.repeat(64),status:'UNRESOLVED',reason:'CONTACT_HTTP_403',retry_eligible_at:'2026-10-18T00:00:00Z'});
 assert(sql.some(x=>x.query.includes('CREATE TABLE IF NOT EXISTS v3_contact_research')));assert.equal(sql.filter(x=>x.query.startsWith('INSERT INTO v3_outlet_directory')).length,0);
 const record=sql.find(x=>x.query.startsWith('INSERT INTO v3_contact_research'));assert.match(record.query,/jsonb_build_array/);assert.equal(JSON.parse(record.args[2]).reason,'CONTACT_HTTP_403');
});
test('query-based Contact Us links are followed and later editorial proof outranks generic duplicate email text',async()=>{
 const result=await createEditorialContactResearch({read:async url=>url.search?'<h2>Editorial</h2><p>Managing editor: editor@journal.example</p>':'<a href="/?page_id=2">Contact Us</a>'})({website:'https://journal.example',publication:'Journal'});
 assert.equal(result.primary.purpose,'named_editor');
 const contacts=extractPublicationContacts('<p>General enquiries: editor@journal.example</p><h2>Editorial</h2><p>Editor: editor@journal.example</p>',{url:'https://journal.example/contact',publication:'Journal'});assert(contacts.some(c=>c.purpose==='named_editor'));
});

test('WordPress boilerplate and contact-data brokers cannot establish directory authority',()=>{
 assert.equal(policy.isDirectoryIdentityText('Our website runs on WordPress.'),false);
 assert.equal(policy.isDirectoryIdentityText('Media directory for lead generation; buy email addresses.'),false);
 assert.equal(policy.isDirectoryIdentityText('We are a magazine publisher and maintain our editorial directory.'),true);
});

test('the live CF Minerals commercial enquiries wording cannot become an editorial recipient',()=>{
 const published='General enquiries info@cf-commodities.com For commodity offers, include the mineral, origin, available quantity, specification or assay, and preferred delivery terms.';
 const contacts=extractPublicationContacts('<h2>Washington DC</h2><p>'+published+'</p>',{url:'https://cf-commodities.com/contact',publication:'CF Minerals Solutions'});
 assert.equal(contacts[0].eligible,false);assert.equal(contacts[0].rejection_reason,'COMMERCIAL_CONTACT_ROLE');
 const d=verified();d.contact.published_excerpt+=' For commodity offers, include the mineral and origin.';assert.equal(Boolean(policy.verifiedDestination(d)),false);
});

test('legitimate general publication enquiries remain eligible',()=>{
 const contacts=extractPublicationContacts('<h2>General enquiries</h2><p>hello@journal.example</p>',{url:'https://journal.example/contact',publication:'Journal'});
 assert.equal(contacts[0].eligible,true);assert.equal(contacts[0].purpose,'general');assert(policy.verifiedDestination(verified()));
});

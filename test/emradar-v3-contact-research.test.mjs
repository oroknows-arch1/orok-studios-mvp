import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorialContactResearch,extractPublicationContacts} from '../vendor/emradar-v3/src/editorial-contact-research.js';
import policy from '../src/emradar-v3-recipient.cjs';
import verified from './fixtures/v3-verified-recipient.cjs';
const html='<h2>Advertising</h2><p>Sales<br>sales@journal.example</p><h2>Subscriptions</h2><p>subscriptions@journal.example</p><h2>Editorial</h2><p>Jane Smith<br>Managing Editor<br><a href="mailto:jane@journal.example">Email Jane</a></p><h2>Website Assistance</h2><p>support@journal.example</p>';
test('navigates official links and enumerates departments before choosing the named editor',async()=>{
 const reads=[];const run=createEditorialContactResearch({read:async url=>{reads.push(url.href);return url.pathname==='/'?'<a href="/contact-us">Contact Us</a>':html;}});
 const result=await run({website:'https://journal.example',publication:'Journal'});
 assert.equal(result.status,'EDITORIAL_CONTACT_VERIFIED');assert.equal(result.primary.email,'jane@journal.example');assert.equal(result.primary.name,'Jane Smith');assert.equal(result.contacts.length,4);assert.equal(result.contacts.filter(c=>!c.eligible).length,3);assert.equal(result.alternatives.length,0);assert.equal(reads.length,2);
 assert.equal((await run({website:'https://journal.example',publication:'Journal'})).primary.email,result.primary.email);assert.equal(reads.length,2);
 assert(policy.verifiedDestination({...verified(),contact:result.primary}));
});
test('403 is not bypassed or retried; an alternative official supplied page can succeed',async()=>{
 const reads=[];const run=createEditorialContactResearch({read:async url=>{reads.push(url.href);if(url.pathname==='/')throw Error('CONTACT_HTTP_403');return html;}});
 const result=await run({website:'https://journal.example',publication:'Journal',sourceUrls:['https://journal.example/contact']});
 assert.equal(result.primary.email,'jane@journal.example');assert.equal(result.failures[0].reason,'CONTACT_HTTP_403');assert.equal(reads.length,2);
});
test('blocked site with no retrieved official evidence returns no contact',async()=>{
 const result=await createEditorialContactResearch({read:async()=>{throw Error('CONTACT_HTTP_403');}})({website:'https://journal.example',publication:'Journal'});
 assert.equal(result.primary,null);assert.equal(result.requests,1);assert.equal(result.pages.length,0);
});
test('publisher contacts require an actual official navigation attribution chain',async()=>{
 const run=createEditorialContactResearch({read:async url=>url.hostname==='journal.example'?'<a href="https://publisher.example/editorial">Editorial</a>':html});
 const result=await run({website:'https://journal.example',publication:'Journal'});
 assert.equal(result.primary.source_url,'https://publisher.example/editorial');
 assert(policy.verifiedDestination({...verified(),contact:result.primary}));
 assert.equal(Boolean(policy.verifiedDestination({...verified(),contact:{...result.primary,publisher_attribution:[]}})),false);
});
test('recipient roles outrank page order; specialist editor and up to two alternatives, never sales',()=>{
 const contacts=extractPublicationContacts('<h2>Sales</h2><p>sales@journal.example</p><h2>Editorial</h2><p>Jane Smith<br>Energy Editor<br>jane@journal.example</p><p>Paul Doe<br>Managing Editor<br>paul@journal.example</p>',{url:'https://journal.example/contact',publication:'Journal',topics:['energy']});
 assert.equal(contacts.find(c=>c.email==='jane@journal.example').rank,0);assert.equal(contacts.find(c=>c.email==='sales@journal.example').eligible,false);
});
test('mailto extraction, general fallback and evidence hashes are independent of suggested addresses',async()=>{
 const result=await createEditorialContactResearch({read:async()=>'<h2>General enquiries</h2><p><a href="mailto:hello@journal.example?subject=Idea">Email us</a></p>'})({website:'https://journal.example',publication:'Journal'});
 assert.equal(result.status,'GENERAL_FALLBACK_VERIFIED');assert.equal(result.primary.email,'hello@journal.example');assert.match(result.primary.page_sha256,/^[a-f0-9]{64}$/);assert(result.primary.published_excerpt.includes(result.primary.email));
});
test('published press/media roles qualify while donation contacts remain non-editorial',()=>{
 const contacts=extractPublicationContacts('<h1>Press</h1><p>We aim to respond to media queries within a few hours.</p><p>press@epoch.ai</p><h2>Donate</h2><p>Please contact us for donation details.</p><p>donate@epoch.ai</p>',{url:'https://epoch.ai/about/press',publication:'Epoch AI'});
 const press=contacts.find(contact=>contact.email==='press@epoch.ai'),donate=contacts.find(contact=>contact.email==='donate@epoch.ai');
 assert.equal(press?.eligible,true);assert.equal(press?.purpose,'editorial');
 assert.equal(donate?.eligible,false);assert.equal(donate?.rejection_reason,'NON_EDITORIAL_ROLE');
});
test('private destinations and unlinked external pages cannot be researched',async()=>{
 let reads=0;const run=createEditorialContactResearch({read:async()=>{reads++;return '<a href="http://127.0.0.1/contact">Contact Us</a><a href="https://attacker.example/contact">Advertisement</a>';}});
 assert.equal((await run({website:'https://journal.example',publication:'Journal'})).primary,null);assert.equal(reads,1);
 assert.equal((await run({website:'http://localhost',publication:'Local'})).primary,null);assert.equal(reads,1);
});

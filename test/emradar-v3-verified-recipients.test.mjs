import test from 'node:test';
import assert from 'node:assert/strict';
import verified from './fixtures/v3-verified-recipient.cjs';
import policy from '../src/emradar-v3-recipient.cjs';
import {OutletDirectory} from '../vendor/emradar-v3/src/outlet-directory.js';
import {contactPurpose,createAutonomousOutletDiscovery} from '../vendor/emradar-v3/src/autonomous-outlet-discovery.js';
import {pruneUnverifiedState,cleanUnverifiedRecipients} from '../vendor/emradar-v3/src/verified-recipient-recovery.js';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {selectDestinations} from '../vendor/emradar-v3/src/destination-selection.js';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';

for(const [text,purpose] of [['Newsroom: editor@journal.example','editorial'],['Contributions: editor@journal.example','submissions'],['Managing editor: Jane Doe editor@journal.example','named_editor'],['Get in touch: hello@journal.example','general'],['Sales team editor@journal.example',null]])test('official contact purpose: '+text,()=>assert.equal(contactPurpose(text,text,new URL('https://journal.example/contact')),purpose));
test('shared rule rejects missing, invented, unsupported and off-site contact proofs',()=>{
 assert(policy.verifiedDestination(verified()));
 for(const mutate of [d=>d.contact=null,d=>d.contact.email='invented@journal.example',d=>d.contact.page_sha256=null,d=>d.contact.source_url='https://imposter.example/contact',d=>d.verification.evidence_ids=[],d=>d.opted_out=true]){
  const d=verified();mutate(d);assert.equal(Boolean(policy.verifiedDestination(d)),false);
 }
});
test('directory rejects unsupported writes and duplicate recipients without INSERT',async()=>{
 let inserts=0;const directory=new OutletDirectory({query:async sql=>{if(sql.startsWith('INSERT'))inserts++;return {rows:[{record:verified('existing')}]};}});
 await assert.rejects(directory.upsert({id:'bad'}),/VERIFIED_RECIPIENT_REQUIRED/);
 await assert.rejects(directory.upsert(verified()),/DUPLICATE_RECIPIENT/);assert.equal(inserts,0);
});
test('missing recipient cannot call the paid writer',async()=>{
 let calls=0;const providers=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>{calls++;}}},images:{generate:async()=>{}}}});
 await assert.rejects(providers.write({campaignId:'campaign',destination:{id:'bad',evidence:{ids:['e1']}},document:{}}),/VERIFIED_RECIPIENT_REQUIRED/);assert.equal(calls,0);
});
test('campaign selection excludes unsupported contacts and deduplicates exact addresses',()=>{
 const d=verified();const selected=selectDestinations({candidates:[{...d,evidence_ids:['e1']},{...d,id:'second',evidence_ids:['e1']},{...d,id:'bad',contact:null,evidence_ids:['e1']}],scanEvidence:[{id:'e1',verified:true}]});
 assert.equal(selected.selected.length,1);assert.deepEqual(selected.selected[0].contact,d.contact);
});
test('cleanup removes unresolved active drafts, preserves decisions, receipts, evidence, X and historical revisions',()=>{
 const state={destinations:[{id:'x'},{id:'bad'},verified()],assets:{x:{asset:{kind:'X'}},bad:{asset:{kind:'EMAIL',body:'Old'}},journal:{asset:{kind:'EMAIL'}}},decisions:{bad:{decision:'REJECT'},x:{decision:'APPROVE'}},deliveries:{bad:{status:'ACCEPTED',receipt:{provider_id:'historical'}}},preparation_input:{document:{evidence:['keep']}},editorial_versions:{bad:[{body:'revision'}]},editorial_rewrite:{variants:['old']}};
 const original=structuredClone(state),result=pruneUnverifiedState(state);
 assert.equal(result.removed,1);assert.equal(state.assets.bad,undefined);assert.equal(state.editorial_versions.bad,undefined);assert.equal(state.editorial_rewrite,undefined);
 for(const field of ['decisions','deliveries','preparation_input'])assert.deepEqual(state[field],original[field]);
 assert.deepEqual(state.assets.x,original.assets.x);assert.deepEqual(result.snapshot.assets.bad,original.assets.bad);assert.equal(pruneUnverifiedState(state).removed,0);
});
test('cleanup commits audit snapshots before removing active records; failures roll back',async()=>{
 const d={id:'bad',contact_verified:false};let value={destinations:[d,{id:'x'}],assets:{bad:{asset:{kind:'EMAIL'}}},decisions:{bad:{decision:'REJECT'}},deliveries:{},events:[],preparation_input:{document:{evidence:[]}}},version=1;const operations=[];
 const client={release:()=>{},query:async(sql,args=[])=>{operations.push(sql);
 if(sql==='SELECT outlet_id,record FROM v3_outlet_directory')return {rows:[{outlet_id:'bad',record:d}]};
 if(sql.startsWith('SELECT campaign_id'))return {rows:[{campaign_id:'campaign'}]};
 if(sql.startsWith('SELECT version'))return {rows:[{version,payload:structuredClone(value)}]};
 if(sql.startsWith('UPDATE v3_campaign_state')){version++;value=JSON.parse(args[2]);return {rowCount:1};}return {rows:[]};}};
 const pool={connect:async()=>client,query:client.query};
 const result=await cleanUnverifiedRecipients({pool,campaignId:'campaign'});
 assert.equal(result.directory_removed,1);assert.equal(result.campaign_destinations_removed,1);assert.equal(value.assets.bad,undefined);assert.equal(value.decisions.bad.decision,'REJECT');
 assert(operations.indexOf(operations.find(s=>s.startsWith('INSERT INTO v3_recipient_audit')))<operations.indexOf('DELETE FROM v3_outlet_directory WHERE outlet_id=$1'));assert(operations.includes('COMMIT'));
 client.query=async sql=>{operations.push(sql);if(sql.includes('CREATE TABLE'))throw Error('DB_FAILURE');return {rows:[]};};
 await assert.rejects(cleanUnverifiedRecipients({pool,campaignId:'campaign'}),/DB_FAILURE/);assert.equal(operations.at(-1),'ROLLBACK');
});
test('review assembly includes saved content without treating recipient readiness as editorial approval',async()=>{
 const d=verified(),campaign={phase:'PUBLICATION_REVIEW',scan:{},destinations:[d,{id:'bad'},{id:'x'}],assets:{journal:{asset:{kind:'EMAIL',destination_id:'journal',to:d.contact.email,contact_status:'VERIFIED',delivery_eligible:true,evidence_ids:['e1'],subject:'Story',body:'Body',from:'sean@emradar.net'}},bad:{asset:{kind:'EMAIL',destination_id:'bad'}},x:{asset:{kind:'X',destination_id:'x'}}},decisions:{bad:{decision:'REJECT'}},deliveries:{}};
 const adapter={read:async()=>({value:campaign}),compareAndSwap:async()=>{throw Error('NO_WRITES');}};
 const workflow=new ReviewWorkflow({store:{adapter},adapter,notify:async()=>{throw Error('NO_EMAILS');},baseUrl:'https://review.example'});workflow.authenticate=async()=>true;
 const result=await workflow.view('campaign');assert.equal(result.entries.length,3);assert.equal(result.entries.find(entry=>entry.asset.destination_id==='bad').recipient_ready,false);assert.equal(campaign.decisions.bad.decision,'REJECT');
});

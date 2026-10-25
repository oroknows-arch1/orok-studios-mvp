import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignPreparation} from '../vendor/emradar-v3/src/preparation.js';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';
import {MemoryAdapter} from '../vendor/emradar-v3-authoritative/src/adapters/memory.js';
import verifiedRecipient from './fixtures/v3-verified-recipient.cjs';
import {enforceSharedProgression} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {validateEditorialCorrespondence,validateEditorialStory} from '../vendor/emradar-v3/src/editorial-reference.js';

const digest='a'.repeat(64);
const scan={snapshot_date:'2026-10-25',artifact_sha256:digest,live_artifact_sha256:digest,archive_artifact_sha256:digest,publication_verified:true};
const document={evidence:[{id:'shared',verified:true},{id:'other',verified:true}],uncertainty:[]};
const destination=(id,evidence=['shared'])=>{const records=document.evidence.filter(item=>evidence.includes(item.id)).map(item=>({...item,fact:item.id,source_url:'https://source.example/'+item.id}));const base=verifiedRecipient(id,records);return {...base,editorial_group_id:'group-'+id,evidence:{ids:evidence}};};
const email=(campaignId,destination,body)=>({campaign_id:campaignId,destination_id:destination.id,kind:'EMAIL',correspondence_type:'EDITORIAL_OUTREACH',subject:'Shared subject',body,from:'sean@emradar.net',to:destination.contact?.email??null,contact_status:destination.contact_verified?'VERIFIED':'UNVERIFIED',delivery_eligible:destination.contact_verified,evidence_ids:destination.evidence.ids});

test('shared progression fallback remains evidence-bound and passes the existing editorial validator',()=>{
 const draft=enforceSharedProgression({subject:'Evidence update',analytical_finding:'Verified capacity constraints are slowing the announced expansion.',limitations:'The supplied evidence does not confirm financing or construction.',story_evidence_ids:['shared']});
 validateEditorialStory(draft,{evidence:[{id:'shared'}]});
 assert.equal(validateEditorialCorrespondence(draft).standard,'semiconductor-progression-v2');
 assert.match(draft.body,/Would an article about this evidence interest you\?/);
});

test('parent runtime prepares one shared proposal and exposes one persisted group',async()=>{
 const store=new CampaignStore(new MemoryAdapter()),calls=[];
 const destinations=[{id:'x',contact_verified:true,evidence:{ids:['shared']}},...Array.from({length:5},(_,index)=>destination('publication-'+index)),destination('individual',['other'])];
 const preparation=new CampaignPreparation({store,discover:async()=>destinations,renderVisual:async()=>({sha256:digest,url:'https://example.org/x.png'}),write:async input=>{
  calls.push(input.sharedDestinations?.map(item=>item.id)??[input.destination.id]);
  if(input.destination.id==='x')return {campaign_id:input.campaignId,destination_id:'x',kind:'X',subject:'X',body:'Evidence',evidence_ids:['shared']};
  return email(input.campaignId,input.destination,input.sharedDestinations?'Exact shared body':'Individual body');
 }});
 const result=await preparation.prepare({scan,document});
 assert.equal(result.status,'PUBLICATION_REVIEW');
 assert.equal(calls.filter(call=>call.length===5).length,1);
 const review=new ReviewWorkflow({store,adapter:store.adapter,baseUrl:'https://review.example',notify:async()=>({accepted:true})});
 review.authenticate=async()=>true;
 const view=await review.view(result.campaignId,'owner','secret');
 const shared=view.groups.find(group=>group.destination_ids.length===5);
 assert.ok(shared);
 assert.equal(new Set(shared.destination_ids.map(id=>view.entries.find(entry=>entry.asset.destination_id===id).asset.body)).size,1);
 assert.ok(view.entries.some(entry=>entry.asset.destination_id==='individual'));
});

test('parent group edit, exclusion and atomic approval survive reload',async()=>{
 const adapter=new MemoryAdapter(),store=new CampaignStore(adapter);
 const id=await store.start(scan),destinations=Array.from({length:5},(_,index)=>destination('publication-'+index));
 await store.select(id,destinations);
 await store.prepare(id,destinations.map(item=>email(id,item,'Exact shared body')));
 const review=new ReviewWorkflow({store,adapter,baseUrl:'https://review.example',notify:async()=>({accepted:true})});review.authenticate=async()=>true;
 let group=(await review.view(id,'owner','secret')).groups[0];
 const stale={hash:group.content_hash,version:group.version};
 await review.reviseGroup(id,'owner','secret',group.id,group.content_hash,group.version,{subject:'Revised shared subject',body:'Revised shared body'});
 group=(await review.view(id,'owner','secret')).groups[0];
 await assert.rejects(review.decideGroup(id,'owner','secret',group.id,'APPROVE',stale.hash,stale.version),/STALE_GROUP_VERSION/);
 await review.removeFromGroup(id,'owner','secret',group.id,'publication-4',group.content_hash,group.version,'EXCLUDE');
 group=(await review.view(id,'owner','secret')).groups.find(item=>item.id===group.id);
 await review.decideGroup(id,'owner','secret',group.id,'APPROVE',group.content_hash,group.version);
 const reloaded=(await adapter.read(id)).value;
 assert.equal(group.destination_ids.length,4);
 assert.equal(reloaded.group_approvals[group.id].destination_ids.length,4);
 assert.equal(Object.values(reloaded.decisions).filter(item=>item.decision==='APPROVE').length,4);
 assert.equal(reloaded.decisions['publication-4'].decision,'EXCLUDE');
 assert.ok(group.destination_ids.every(destinationId=>reloaded.assets[destinationId].asset.body==='Revised shared body'));
});

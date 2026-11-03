import test from 'node:test';
import assert from 'node:assert/strict';
import brand from '../src/email-brand.cjs';
import destination from './fixtures/v3-verified-recipient.cjs';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';
import {createReviewServer} from '../vendor/emradar-v3/src/http.js';
import {assetFingerprint,identicalEmailGroupKey} from '../vendor/emradar-v3/src/contracts.js';
import {MemoryAdapter} from '../vendor/emradar-v3-authoritative/src/adapters/memory.js';

for(const shared of [false,true])test((shared?'shared':'individual')+' branded email replacement persists through authenticated revision HTTP and fresh view',async t=>{
 const adapter=new MemoryAdapter(),store=new CampaignStore(adapter),digest='a'.repeat(64);
 const id=await store.start({snapshot_date:'2026-11-03',artifact_sha256:digest,live_artifact_sha256:digest,archive_artifact_sha256:digest,publication_verified:true});
 const destinations=shared?[destination('one'),destination('two')]:[destination('one')];
 await store.select(id,destinations);
 const assets=destinations.map(d=>brand.brand({campaign_id:id,destination_id:d.id,kind:'EMAIL',contact_status:'VERIFIED',delivery_eligible:true,evidence_ids:['e1'],subject:'Subject',body:'Original investigation\n\nSean Walker\nEMRADAR',to:d.contact.email}));
 await store.prepare(id,assets);
 let link;const diagnostics=[];
 const workflow=new ReviewWorkflow({store,adapter,baseUrl:'https://review.example',notify:async message=>{link=message.link;return {accepted:true,provider_id:'mock-only',recipient:message.recipient,campaign_id:message.campaignId};}});
 await workflow.issue(id);
 const token=new URLSearchParams(new URL(link).hash.slice(1)).get('token');
 const server=createReviewServer({workflow,logRevisionDiagnostic:line=>diagnostics.push(line)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 let cookie='',csrf='';
 const request=async(path,payload,csrfValue=csrf)=>{
  const response=await fetch(origin+'/api/review/'+path,{method:'POST',headers:{'content-type':'application/json',cookie,'x-emradar-csrf':csrfValue},body:JSON.stringify(payload)});
  const set=response.headers.getSetCookie();if(set.length){cookie=set.map(v=>v.split(';')[0]).join('; ');csrf=cookie.split('; ').find(v=>v.startsWith('emradar_v3_csrf=')).split('=')[1];}
  return {status:response.status,value:await response.json()};
 };
 assert.equal((await request('exchange',{campaignId:id,token})).status,200);
 let view=(await request('view',{campaignId:id})).value;
 const before=structuredClone(view);
 if(shared)await store.decideGroup(id,view.groups[0].id,'APPROVE',view.groups[0].content_hash,view.groups[0].version);
 else await store.decide(id,'one','APPROVE',view.entries[0].fingerprint);
 const path=shared?'group-revise':'revise';
 const binding=shared?{groupId:view.groups[0].id,contentHash:view.groups[0].content_hash,version:view.groups[0].version}:{destinationId:'one',fingerprint:view.entries[0].fingerprint};
 const replacement='Revised investigation.\n\nRegards,\n\n'+brand.signature.split('\n').map(line=>line+'  ').join('\n');
 assert.equal((await request(path,{campaignId:id,...binding,changes:{body:replacement}},'wrong-csrf')).status,403);
 const response=await request(path,{campaignId:id,...binding,changes:{body:replacement}});
 assert.equal(response.status,200,JSON.stringify(response.value));
 view=(await request('view',{campaignId:id})).value;
 for(const item of view.entries){
  assert.equal(item.asset.body,'Revised investigation.\n\nRegards,\n\n'+brand.signature+'\n\n'+brand.disclaimer);
  assert.equal(item.asset.html,brand.render(item.asset.body));assert.equal(item.fingerprint,assetFingerprint(item.asset));
  assert.equal(item.asset.to,before.entries.find(e=>e.asset.destination_id===item.asset.destination_id).asset.to);
  assert.equal(item.decision,null);assert.equal(item.delivery,null);
  await assert.rejects(store.claimDelivery(id,item.asset.destination_id),/OWNER_APPROVAL_REQUIRED/);
 }
 if(shared){assert.equal(view.groups[0].content_hash,identicalEmailGroupKey(view.entries[0].asset));assert.equal(view.groups[0].approval,null);}
 const stale=await request(path,{campaignId:id,...binding,changes:{body:'Stale overwrite'}});
 assert.equal(stale.status,409);assert.equal(stale.value.error,shared?'STALE_GROUP_VERSION':'STALE_ASSET_REVISION');
 assert.match(stale.value.diagnostic_id,/^[a-f0-9-]{36}$/);assert(!diagnostics.some(line=>line.includes(replacement)||line.includes(token)));

 const record=(await adapter.read('review:'+id)).value.owner_session;
 // The same authenticated HTTP session remains live across fresh page views.
 const fresh=(await request('view',{campaignId:id})).value;
 assert.deepEqual(fresh.entries.map(e=>e.asset.body),view.entries.map(e=>e.asset.body));assert(record);
 assert.equal((await request(path,{campaignId:id,...binding,changes:{body:'Unauthorized'}},'')).status,403);
 const currentBinding=shared?{groupId:fresh.groups[0].id,contentHash:fresh.groups[0].content_hash,version:fresh.groups[0].version}:{destinationId:'one',fingerprint:fresh.entries[0].fingerprint};
 const persisted=structuredClone((await adapter.read(id)).value);
 const write=adapter.compareAndSwap.bind(adapter);adapter.compareAndSwap=async()=>{throw Error('private database details must never escape');};
 const failed=await request(path,{campaignId:id,...currentBinding,changes:{body:'Must remain unsaved'}});
 adapter.compareAndSwap=write;
 assert.equal(failed.status,500);assert.equal(failed.value.error,'REVISION_SAVE_FAILED');assert.equal(failed.value.saved,undefined);
 assert.deepEqual((await adapter.read(id)).value,persisted);
 assert(!JSON.stringify(failed.value).includes('private database'));assert(!diagnostics.some(line=>line.includes('private database')));

});
test('canonical footer is idempotent for an unchanged body, trailing newline, and pasted footer',()=>{
 const original=brand.brand({body:'Original\n\nSean Walker\nEMRADAR'}).body;
 assert.equal(brand.reviewBody(original),original);assert.equal(brand.reviewBody(original+'\n'),original);
 assert.equal(brand.reviewBody('Replacement'), 'Replacement\n\n'+brand.signature+'\n\n'+brand.disclaimer);
});

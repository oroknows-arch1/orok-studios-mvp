import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fingerprint,Workspace} from '../vendor/emradar-v3-authoritative/clean/workspace.js';
import {formatEmail} from '../src/marketing/runtime.mjs';
import {campaignAsk,matchOutlets} from '../src/marketing/provider.mjs';
import {renderGraphic} from '../src/marketing/graphic.mjs';
import x from '../src/emradar-v3-x.cjs';
import brand from '../src/email-brand.cjs';
import recipient from '../src/emradar-v3-recipient.cjs';
import {createV3Release} from '../src/emradar-v3-release.cjs';

test('real PNG bytes and brand envelope match the saved rendered versions',async()=>{
 const row={record_id:'case',location:'Mato Grosso, Brazil',facts:[{statement:'AIIB and FS announced financing.'}],actors:['FS','AIIB','prospective regional suppliers']};
 const visual=await renderGraphic([row],{snapshot_date:'2026-11-25'});
 assert.equal(x.graphic({kind:'X',destination_id:'x',body:'Brazil · FS + AIIB',...visual}).mime,'image/png');
 const asset=formatEmail({kind:'EMAIL',to:'editor@example.org',subject:'A financing question',body:'Who supplies the fourth facility?'});
 assert.equal(brand.envelope(asset).text,asset.body);
 assert.equal(brand.envelope(formatEmail({...asset,body:'Edited text'})).html.includes('Edited text'),true);
});
test('search reuses a completed request and reserves a concurrent attempt only once',async()=>{
 let campaign={research_calls:{}},calls=0;
 const adapter={read:async()=>({value:structuredClone(campaign)})};
 const workspace={mutate:async(id,fn)=>{fn(campaign);return campaign}};
 const openai={responses:{create:async()=>{calls++;return {id:'test',output_text:'{"facts":[]}',usage:{total_tokens:10},output:[]}}}};
 const ask=campaignAsk({adapter,workspace,openai,campaignId:'c',budget:{reserve:async()=>({}),settle:async()=>{}}});
 await Promise.allSettled([ask('formation','test',{}),ask('formation','test',{})]);await ask('formation','test',{});
 assert.equal(calls,1);assert.equal(Object.values(campaign.research_calls)[0].usage.total_tokens,10);
});
test('outlet discovery uses actual contact text, honours opt-outs, and keeps saved directory identity',async()=>{
 const pool={query:async sql=>({rows:sql.startsWith('SELECT 1')?[]:[{outlet_id:'saved',record:{name:'Existing publication',contact:{email:'editor@example.org'}}}]})};
 const match={record_id:'f',fit:'Trade readership',readership:'Industrial operators'};
 const result=await matchOutlets({pool,formations:[{record_id:'f',facts:[{statement:'a fact'}]}],
 ask:async()=>({matches:[{...match,directory_id:'saved'},{...match,name:'Unknown',email:'invented@example.org',website:'https://example.org',contact_url:'https://example.org/contact'}]}),read:async()=>'No address here'});
 assert.deepEqual(result.map(d=>d.id),['saved']);
});
test('real release claim and stored receipt survive per-recipient transport failures',async()=>{
 const id='campaign',a=key=>({kind:'EMAIL',campaign_id:id,destination_id:key,subject:'Subject',body:'Pitch',to:key+'@example.org'});
 let state={id,phase:'PUBLICATION_REVIEW',destinations:[],assets:{},decisions:{},deliveries:{}},version=1;
 for(const key of ['accepted','uncertain','optout']){const asset=a(key);state.assets[key]={asset,fingerprint:fingerprint(asset)};
 state.decisions[key]={authority:'OWNER',decision:'APPROVE',campaign_id:id,destination_id:key,asset_sha256:fingerprint(asset)}}
 const adapter={read:async()=>({value:structuredClone(state),version}),compareAndSwap:async(_,v,next)=>{if(v!==version)return false;state=structuredClone(next);version++;return true}};
 const store=new Workspace({adapter,formatEmail,checkRecipient:recipient.assertRecipientAllowed,checkGraphic:x.graphic});
 const pool={query:async(sql,args)=>({rows:args[0]==='optout'?[{record:{opted_out:true}}]:[]})};
 let sends=0;const integration={handle:async({payload})=>{sends++;if(payload.destination_id==='uncertain')throw Error('NETWORK_TIMEOUT');return {accepted:true,receipt_id:'mock-provider-1'}}};
 const release=createV3Release({pool,env:{EMRADAR_V3_DISTRIBUTION_PAUSED:'false'},integration,service:{store,workflow:{authenticate:async()=>true}}});
 const send=key=>release({campaignId:id,destinationId:key,fingerprint:state.assets[key].fingerprint,sessionId:'owner',sessionSecret:'mock'});
 await assert.rejects(send('uncertain'),/AMBIGUOUS/);await assert.rejects(send('optout'),/OPTED_OUT/);await send('accepted');
 assert.equal(state.deliveries.accepted.receipt.provider_id,'mock-provider-1');assert.equal(state.deliveries.uncertain.status,'AMBIGUOUS');
 await assert.rejects(send('uncertain'));await assert.rejects(send('accepted'));assert.equal(sends,2);
});
test('public entry loads the replacement and the review document contains valid browser JavaScript',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/import\('\.\/src\/marketing\/runtime.mjs'\)/);assert.doesNotMatch(server,/emradar-v3-runtime|createHarnessRelay|runEditorialRecovery/);
 const page=readFileSync(new URL('../vendor/emradar-v3-authoritative/clean/review.html',import.meta.url),'utf8');
 new vm.Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
});

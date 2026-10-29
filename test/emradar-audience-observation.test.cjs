'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createV3X}=require('../src/emradar-v3-x.cjs');
const {createAudienceObservation}=require('../src/emradar-audience-observation.cjs');
const scope='tweet.read tweet.write users.read media.write offline.access';
test('metrics verify account ownership and retain only observed provider counts without posting',async()=>{
 const calls=[],x=createV3X({auth:{current:async()=>({access_token:'staging',scope}),verifyAccount:async()=>({account_id:'42'})},fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({data:[{id:'11',author_id:'42',public_metrics:{like_count:3,reply_count:1}}]})}}});
 const result=await x.readThreadMetrics({post_ids:['11']});assert.deepEqual(result.posts[0].metrics,{like_count:3,reply_count:1});assert.equal(result.posts[0].metrics.impression_count,undefined);assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);
 await assert.rejects(()=>x.readThreadMetrics({post_ids:['11','11']}),/METRIC_POST_IDS_INVALID/);
});
test('foreign account metrics fail closed',async()=>{
 const x=createV3X({auth:{current:async()=>({access_token:'staging',scope}),verifyAccount:async()=>({account_id:'42'})},fetcher:async()=>({ok:true,json:async()=>({data:[{id:'11',author_id:'99',public_metrics:{like_count:3}}]})})});
 await assert.rejects(()=>x.readThreadMetrics({post_ids:['11']}),/METRIC_OWNERSHIP_UNVERIFIED/);
});
test('durable metric claims bound reads and preserve unavailable referrals as unknown',async()=>{
 const data=new Map([['c',{version:1,value:{audience_x_review:{manifest_sha256:'hash'},audience_x_publication:{status:'COMPLETE',manifest_sha256:'hash',posts:[{post_id:'11'}]}}}]]);
 const adapter={read:async key=>structuredClone(data.get(key)),compareAndSwap:async(key,version,value)=>{if((data.get(key)?.version??null)!==version)return false;data.set(key,{version:(version??0)+1,value:structuredClone(value)});return true}},store={adapter,mutate:async(key,fn)=>{const prior=data.get(key),value=fn(structuredClone(prior.value));data.set(key,{version:prior.version+1,value});return value}};
 let reads=0;const x={readThreadMetrics:async()=>{reads++;return {observed_at:new Date().toISOString(),posts:[{post_id:'11',metrics:{like_count:1}}]}}};
 const observe=createAudienceObservation({store,x,enabled:true,clock:()=>1000});
 const result=await observe('c');assert.equal(result.referrals,null);assert.equal(result.referral_status,'ANALYTICS_NOT_CONNECTED');assert.equal((await observe('c')).status,'ALREADY_CLAIMED');assert.equal(reads,1);
 const disabled=createAudienceObservation({store,x});assert.equal((await disabled('c')).status,'DISABLED');assert.equal(reads,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';
import {createReviewServer} from '../vendor/emradar-v3/src/http.js';

const campaignId='test-review-access';
const digest=value=>createHash('sha256').update(value).digest('hex');

async function harness({record=null,requestRecorded=false,notify=async()=>{throw Error('MUST_NOT_SEND');}}={}){
 const data=new Map([[campaignId,{phase:'PUBLICATION_REVIEW'}]]);
 if(record)data.set('review:'+campaignId,record);
 if(requestRecorded)data.set('review-access-request:'+campaignId+':2026-11-18',{status:'REQUESTED'});
 const adapter={
  read:async key=>data.has(key)?{value:data.get(key),version:1}:null,
  compareAndSwap:async(key,expected,value)=>{if(expected===null&&data.has(key))return false;data.set(key,value);return true;}
 };
 const workflow=new ReviewWorkflow({store:{adapter},adapter,notify,baseUrl:'https://example.test',clock:()=>Date.parse('2026-11-18T08:00:00Z')});
 const server=createReviewServer({workflow});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {server,post:async(token,cookie)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/review/request-access',{method:'POST',headers:{'origin':'https://example.test','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({campaignId,token})});return {status:response.status,body:await response.json()};}};
}

test('invalid proof responds with access denial without crashing the server',async()=>{
 const {server,post}=await harness();
 try{
  const first=await post('invalid');
  assert.equal(first.status,403);
  assert.equal(first.body.error,'REVIEW_ACCESS_DENIED');
  const second=await post('invalid');
  assert.equal(second.status,403);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('recorded same-day recovery request gives a distinct rate-limit response',async()=>{
 const {server,post}=await harness({record:{campaign_id:campaignId,token_hash:digest('known'),status:'CONSUMED',expires_at:Date.parse('2026-11-19T08:00:00Z'),owner_session:null},requestRecorded:true});
 try{
  const result=await post('known');
  assert.equal(result.status,429);
  assert.equal(result.body.error,'REVIEW_ACCESS_REQUEST_ALREADY_RECORDED');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('valid still-active invitation returns existing status without sending',async()=>{
 const {server,post}=await harness({record:{campaign_id:campaignId,token_hash:digest('known'),status:'NOTIFIED',expires_at:Date.parse('2026-11-19T08:00:00Z'),owner_session:null}});
 try{
  const result=await post('known');
  assert.equal(result.status,200);
  assert.equal(result.body.status,'EXISTING_INVITATION');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('active session reopens without mail while an expired session cannot authorize recovery',async()=>{
 const secret='owner-secret',session={id:'session-1',role:'OWNER',campaign_id:campaignId,secret_hash:digest(secret),expires_at:Date.parse('2026-11-19T08:00:00Z'),revoked_at:null};
 const {server,post}=await harness({record:{campaign_id:campaignId,token_hash:digest('used'),status:'CONSUMED',expires_at:Date.parse('2026-11-19T08:00:00Z'),owner_session:session}});
 try{
  const active=await post(null,'emradar_v3_session='+session.id+'.'+secret);assert.equal(active.status,200);assert.equal(active.body.status,'ACTIVE_SESSION');
  session.expires_at=Date.parse('2026-11-17T08:00:00Z');
  const expired=await post(null,'emradar_v3_session='+session.id+'.'+secret);assert.equal(expired.status,403);assert.equal(expired.body.error,'REVIEW_ACCESS_DENIED');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('uncertain mail outcome is recorded once and cannot cause a duplicate request',async()=>{
 const record={campaign_id:campaignId,token_hash:digest('used'),status:'CONSUMED',expires_at:Date.parse('2026-11-17T08:00:00Z'),owner_session:null};
 const {server,post}=await harness({record});
 try{
  const first=await post('used');assert.equal(first.status,503);assert.equal(first.body.error,'REVIEW_NOTIFICATION_AMBIGUOUS');
  const second=await post('used');assert.equal(second.status,403);assert.equal(second.body.error,'REVIEW_ACCESS_DENIED');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

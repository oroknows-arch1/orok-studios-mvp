import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAutonomousOutletDiscovery} from '../vendor/emradar-v3/src/autonomous-outlet-discovery.js';

test('rediscovery preserves a verified contact when contact retrieval fails',async()=>{
 const hostname='journal.example';
 const id='web-'+createHash('sha256').update(hostname).digest('hex').slice(0,20);
 const verified={
  id,name:'Journal',category:'mining',website:'https://journal.example',
  active:true,contact_verified:true,editorial_fit_verified:true,
  contact:{email:'editor@journal.example',source_url:'https://journal.example/editorial',checked_at:'2026-10-13T00:00:00Z'},
  verification:{method:'live_editorial_contact_page',evidence_ids:['old']}
 };
 const records=new Map([[id,structuredClone(verified)]]);
 const directory={
  list:async()=>[...records.values()],
  upsert:async record=>{records.set(record.id,structuredClone(record));}
 };
 const openai={responses:{create:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({candidates:[{
  name:'Journal',category:'mining',website:'https://journal.example',
  contact_url:'https://journal.example/editorial',email:'editor@journal.example',evidence_ids:['e1']
 }]})}]}]})}};
 const discovery=createAutonomousOutletDiscovery({
  openai,directory,resolver:async()=>[{address:'8.8.8.8'}],
  contactReader:async()=>{throw Error('CONTACT_RESPONSE_INVALID');}
 });
 const document={evidence:[{id:'e1',verified:true,fact:'Verified mining change',source_url:'https://source.example/report',record_id:'r1'}]};
 const links=await discovery({document,outlets:[]});
 assert.deepEqual(links,[]);
 assert.equal(records.size,1);
 assert.deepEqual(records.get(id),verified);
});

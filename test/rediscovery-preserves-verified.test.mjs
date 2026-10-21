import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import recipientFixture from './fixtures/v3-verified-recipient.cjs';
import {createAutonomousOutletDiscovery} from '../vendor/emradar-v3/src/autonomous-outlet-discovery.js';

test('rediscovery preserves a verified contact when contact retrieval fails',async()=>{
 const hostname='journal.example';
 const id='web-'+createHash('sha256').update(hostname).digest('hex').slice(0,20);
 const verified={
  id,name:'Journal',category:'mining',website:'https://journal.example',
  destination_class:'EDITORIAL_PUBLICATION',active:true,contact_verified:true,editorial_fit_verified:true,
  contact:{...recipientFixture(id).contact,email:'editor@journal.example',published_excerpt:'Editorial: editor@journal.example',source_url:'https://journal.example/editorial',checked_at:'2026-10-13T00:00:00Z'},
  verification:{...recipientFixture(id).verification,method:'live_editorial_contact_page',evidence_ids:['old']}
 };
 const records=new Map([[id,structuredClone(verified)]]);
 const directory={
  list:async()=>[...records.values()],
  upsert:async record=>{records.set(record.id,structuredClone(record));}
 };
 const openai={responses:{create:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({candidates:[{
  name:'Journal',category:'mining',publication_type:'trade_publication',website:'https://journal.example',publication_proof_url:'https://journal.example/news',
  contact_url:'https://journal.example/editorial',email:'editor@journal.example',formation_ids:['r1'],industries:['Mining'],ecosystem_formation_ids:['r1'],evidence_ids:['e1'],relationship_reason:'Covers mining.'
 }]})}]}]})}};
 const discovery=createAutonomousOutletDiscovery({
  openai,directory,resolver:async()=>[{address:'8.8.8.8'}],
  contactReader:async url=>url.pathname==='/news'?'News and analysis':Promise.reject(Error('CONTACT_RESPONSE_INVALID'))
 });
 const document={records:[{id:'r1',causal_chain:{industries:['Mining']}}],evidence:[{id:'e1',verified:true,fact:'Verified mining change',source_url:'https://source.example/report',record_id:'r1'}]};
 const links=await discovery({document,outlets:[]});
 assert.equal(links.length,1);
 assert.equal(records.size,1);
 assert.equal(records.get(id).contact_verified,true);
 assert.deepEqual(records.get(id).contact,{...verified.contact,alternatives:[]});
});

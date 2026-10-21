import test from 'node:test';
import assert from 'node:assert/strict';
import {excludeSourceInstitutionDestinations} from '../vendor/emradar-v3/src/preparation-review-service.js';
import {OutletDirectory} from '../vendor/emradar-v3/src/outlet-directory.js';
import {sha256} from '../vendor/emradar-v3/src/contracts.js';
test('institution exclusion preserves drafts as history, owner decisions and mandatory X',async()=>{
 const document={records:[],evidence:[{id:'e1',verified:true,fact:'Source fact',source_url:'https://source.example/fact'}]};
 const digest=sha256(JSON.stringify(document.evidence.map(e=>[e.id,e.fact,e.source_url])));
 const institution={id:'association',name:'Southern African Institute of Mining and Metallurgy',website:'https://saimm.example',publication_type:'industry_association',verification:{scan_evidence_digest:digest}};
 const approved={id:'approved-institution',name:'World Bank',website:'https://worldbank.example'};
 const journal={id:'journal',name:'Journal of the Southern African Institute of Mining and Metallurgy',website:'https://saimm.example',publication_type:'journal'};
 let state={preparation_input:{document},destinations:[{id:'x'},institution,approved,journal],assets:{x:{asset:{body:'Keep X',visual_base64:'Keep image'}},association:{asset:{body:'Retain the old draft'}},'approved-institution':{asset:{body:'Owner decided'}},journal:{asset:{body:'Real journal'}}},decisions:{'approved-institution':{decision:'REJECT'}},deliveries:{}};
 const before=structuredClone(state),excluded=[];
 const store={adapter:{read:async()=>({value:structuredClone(state)})},mutate:async(_id,fn)=>{state=fn(structuredClone(state));return state;}};
 const directory={list:async()=>[institution],excludePublication:async id=>{excluded.push(id);return true;}};
 await excludeSourceInstitutionDestinations({store,directory,campaignId:'existing'});
 assert.deepEqual(excluded,['association']);assert(!state.destinations.some(d=>d.id==='association'));assert(state.destinations.some(d=>d.id==='journal'));
 assert.deepEqual(state.discovery_exclusions.association.asset,before.assets.association);assert.deepEqual(state.assets.x,before.assets.x);assert.deepEqual(state.decisions,before.decisions);assert.deepEqual(state.assets['approved-institution'],before.assets['approved-institution']);
});
test('directory exclusion retains the prior record and cannot overwrite a concurrently changed publisher',async()=>{
 const previous={id:'association',name:'Association',website:'https://association.example',verification:{scan_evidence_digest:'digest'}};
 for(const rowCount of [0,1]){
  const calls=[];const directory=new OutletDirectory({query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT'))return {rows:[{record:previous}]};return {rows:[],rowCount};}});
  assert.equal(await directory.excludePublication(previous.id,'SOURCE_INSTITUTION_NOT_PUBLICATION'),rowCount===1);
  const update=calls.find(x=>x.sql.startsWith('UPDATE'));assert.match(update.sql,/AND record=\$3::jsonb/);
  const patch=JSON.parse(update.args[1]);assert.equal(patch.active,false);assert.deepEqual(patch.exclusion.previous_record,previous);
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO v3_contact_research')).length,rowCount);
 }
});

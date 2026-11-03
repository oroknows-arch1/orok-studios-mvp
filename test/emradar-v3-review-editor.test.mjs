import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {reviewPage} from '../vendor/emradar-v3/src/review-page.js';
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.events={};this.textContent='';this.value='';}
 append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 setAttribute(){}
 addEventListener(name,fn){this.events[name]=fn;}
 focus(){}
 showModal(){this.open=true;}
 close(){this.open=false;this.events.close?.();}
 remove(){this.parent.children=this.parent.children.filter(child=>child!==this);}
 async click(){if(!this.disabled)await this.events.click?.();}
}
const walk=el=>[el,...el.children.flatMap(walk)];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function browser(state,request){
 const body=new Element('body'),status=new Element('p'),main=new Element('main');body.append(status,main);
 const document={body,cookie:'',createElement:tag=>new Element(tag),getElementById:id=>id==='status'?status:main};
 const script=reviewPage.split('<script>')[1].split('</script>')[0];
 runInNewContext(script,{document,history:{replaceState(){}},location:{hash:'',search:'?campaign=test',origin:'https://example.org'},URL,URLSearchParams,fetch:async(url,options)=>{
  const path=url.split('/').at(-1),payload=JSON.parse(options.body);
  const result=path==='view'?structuredClone(state):await request(path,payload);
  return {ok:true,json:async()=>result};
 }});
 await tick();
 return {body,status,main,button:label=>walk(body).find(el=>el.tag==='button'&&el.textContent===label),field:()=>walk(body).find(el=>['input','textarea'].includes(el.tag)),dialog:()=>walk(body).find(el=>el.tag==='dialog')};
}
const entry=id=>({asset:{destination_id:id,kind:'EMAIL',subject:'Subject',body:'Original'},fingerprint:'original',recipientVerified:true});
for(const shared of [false,true])for(const field of ['subject','body']){
 test((shared?'shared':'individual')+' '+field+' saves, refreshes, cancels and retains failed text',async()=>{
  const entries=shared?[entry('one'),entry('two')]:[entry('one')];
  const group={id:'group',destination_ids:['one','two'],subject:'Subject',body:'Original',version:1,content_hash:'hash'};
  if(shared)entries.forEach(e=>e.groupId='group');
  const state={entries,groups:shared?[group]:[]};let fail=false,calls=0;
  const request=async(path,payload)=>{
   calls++;if(fail)throw Error('offline');
   assert.equal(path,shared?'group-revise':'revise');
   assert.deepEqual(Object.keys(payload.changes),[field]);
   if(shared){assert.equal(payload.contentHash,'hash');assert.equal(payload.version,1);Object.assign(group,payload.changes);}
   else assert.equal(payload.fingerprint,'original');
   entries.forEach(e=>Object.assign(e.asset,payload.changes));return {};
  };
  let ui=await browser(state,request);
  const label=shared?'Edit shared '+field:field==='body'?'Edit draft':'Edit subject';
  await ui.button(label).click();ui.field().value='Discard';await ui.button('Cancel').click();assert.equal(calls,0);
  await ui.button(label).click();ui.field().value='Revised\ncopy';fail=true;await ui.button('Save Changes').click();
  assert.equal(ui.field().value,'Revised\ncopy');assert.equal(ui.dialog().open,true);assert.equal(ui.button('Save Changes').disabled,false);
  fail=false;await ui.button('Save Changes').click();assert.equal(ui.dialog(),undefined);assert.match(ui.status.textContent,/Edited · Saved/);
  ui=await browser(state,request);await ui.button(label).click();assert.equal(ui.field().value,'Revised\ncopy');assert.equal(calls,2);
 });
}
test('saving prevents Escape and keeps the field stable until the request settles',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const ui=await browser({entries:[entry('one')],groups:[]},()=>pending);
 await ui.button('Edit draft').click();ui.field().value='Revised';
 const save=ui.button('Save Changes').click();assert.equal(ui.field().readOnly,true);
 let prevented=false;ui.dialog().events.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);
 assert.equal(ui.button('Cancel').disabled,true);finish({});await save;assert.equal(ui.dialog(),undefined);
});
test('a failed refresh after a successful save reports saved and removes stale decision controls',async()=>{
 const state={entries:[entry('one')],groups:[]};
 const ui=await browser(state,async()=>{Object.defineProperty(state,'entries',{enumerable:true,get(){throw Error('offline');}});return {};});
 await ui.button('Edit draft').click();ui.field().value='Saved';await ui.button('Save Changes').click();
 assert.equal(ui.dialog(),undefined);assert.match(ui.status.textContent,/Edited · Saved.*Could not reload/);assert.equal(ui.main.children.length,0);
});

test('stale save explains recovery while retaining unsaved text and never claiming success',async()=>{
 const ui=await browser({entries:[entry('one')],groups:[]},async()=>{throw Error('STALE_ASSET_REVISION');});
 await ui.button('Edit draft').click();ui.field().value='Unsaved owner revision';await ui.button('Save Changes').click();
 assert.equal(ui.field().value,'Unsaved owner revision');assert.equal(ui.dialog().open,true);
 assert(walk(ui.dialog()).some(el=>el.textContent.includes('This email changed since you opened it')));
 assert(!walk(ui.body).some(el=>el.textContent.includes('Edited · Saved')));
});

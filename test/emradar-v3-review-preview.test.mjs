import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {reviewPage} from '../vendor/emradar-v3/src/review-page.js';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';

class Element {
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attributes={};this.textContent='';}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(name,handler){this.listeners[name]=handler;}
}
const flatten=element=>[element,...element.children.flatMap(flatten)];
async function render(view){
 const elements=Object.fromEntries(['status','entries','discover','connect-x','check-x'].map(id=>[id,new Element(id)]));
 const calls=[],payloads=[];
 const context={document:{cookie:'',getElementById:id=>elements[id],createElement:tag=>new Element(tag)},location:{origin:'https://review.example',hash:'',search:'?campaign=campaign',pathname:'/review/access'},history:{replaceState(){}},URL,URLSearchParams,prompt:()=> 'Make the analytical contribution clearer without changing the verified finding.',fetch:async(path,options={})=>{calls.push(path);if(options.body)payloads.push(JSON.parse(options.body));return {ok:true,json:async()=>path==='/api/review/decision'?{saved:true,regeneration_status:'PENDING'}:view};}};
 const script=reviewPage.match(/<script>([\s\S]*)<\/script>/)[1];
 await new vm.Script(script).runInNewContext(context);
 return {...elements,calls,payloads};
}
test('actual review script renders full X text and saved image while publishing is disabled',async()=>{
 const body='Complete approved X text\nwith every saved line.';
 const image=Buffer.from('saved graphic bytes').toString('base64');
 const result=await render({entries:[{asset:{kind:'X',destination_id:'x',body,visual_mime:'image/png',visual_base64:image},decision:{decision:'APPROVE'}}],publishing:{x:{enabled:false,reason:'X publishing is disabled.'}}});
 const nodes=flatten(result.entries),graphic=nodes.find(n=>n.tag==='img');
 assert.equal(graphic.src,'data:image/png;base64,'+image);assert.equal(graphic.className,'review-graphic');
 assert.equal(nodes.find(n=>n.tag==='pre').textContent,body);
 assert(nodes.some(n=>n.textContent==='X publishing is disabled.'));
 assert.equal(nodes.find(n=>n.textContent==='Publish approved X post').disabled,true);
 for(const label of ['Edit draft','Approve','Reject'])assert(!nodes.find(n=>n.textContent===label).disabled);
 assert.deepEqual(result.calls,['/api/review/view']);
});
test('owner review captures rejection feedback and displays the durable regeneration state',async()=>{
 const view={entries:[{asset:{kind:'EMAIL',destination_id:'journal',subject:'A story',body:'Draft text',review_status:'READY'},fingerprint:'asset-hash',review_action:{action:'REGENERATE',status:'NEEDS_FEEDBACK'},rejection_feedback:[]}],publishing:{email:{enabled:true}}};
 const result=await render(view),nodes=flatten(result.entries);
 assert(nodes.some(node=>node.textContent==='Rejection saved — owner feedback is needed before regeneration.'));
 await nodes.find(node=>node.textContent==='Reject').listeners.click();
 const decision=result.payloads.find(payload=>payload.decision);
 assert.equal(decision.decision,'REJECT');assert.equal(decision.feedback,'Make the analytical contribution clearer without changing the verified finding.');
 assert.equal(result.calls.filter(path=>path==='/api/review/decision').length,1);
});
test('all saved email content is visible, including unresolved drafts and historical alternatives',async()=>{
 const asset={kind:'EMAIL',destination_id:'journal',subject:'Specific article idea',body:'Complete body\nwith signature.',html:'<p>Complete HTML email</p>'};
 const result=await render({entries:[{asset,recipient_ready:false,destination:{name:'Publication'},decision:{decision:'REJECT'}}],history:[{asset:{...asset,body:'Previous saved body'},historical:true,label:'Previous draft'}]});
 const nodes=flatten(result.entries);assert.equal(result.entries.children.length,2);
 for(const value of ['Publication',asset.subject,asset.body,'Previous saved body','Recipient unavailable','Editorial decision: REJECT','Delivery: Not released'])assert(nodes.some(n=>n.textContent===value));
 assert.equal(nodes.find(n=>n.tag==='iframe').srcdoc,asset.html);assert.equal(nodes.find(n=>n.tag==='iframe').attributes.sandbox,'');
 assert.equal(nodes.find(n=>n.textContent==='Send approved email').disabled,true);
 for(const label of ['Edit draft','Edit subject','Approve','Reject'])assert(!nodes.find(n=>n.textContent===label).disabled);
 assert(!flatten(result.entries.children[1]).some(n=>n.tag==='button'));
});
test('accepted email remains fully visible with receipt, with resend and post-delivery edits disabled',async()=>{
 const result=await render({entries:[{asset:{kind:'EMAIL',destination_id:'journal',to:'editor@example.org',subject:'Approved subject',body:'Already sent body'},decision:{decision:'APPROVE'},delivery:{status:'ACCEPTED',receipt:{provider_id:'message-id',sent_folder:{status:'FILED'}}}}]});
 const nodes=flatten(result.entries);
 for(const value of ['Already sent body','Editorial decision: APPROVE','Delivery: ACCEPTED','Mail receipt: message-id · Sent folder: FILED'])assert(nodes.some(n=>n.textContent===value));
 assert.equal(nodes.find(n=>n.textContent==='Send approved email').disabled,true);
 assert.equal(nodes.find(n=>n.textContent==='Approve').disabled,true);assert(!nodes.some(n=>n.textContent==='Edit draft'));
});
test('HTTPS and saved data graphics render; unsafe graphic schemes do not',async()=>{
 for(const source of ['https://assets.example/graphic.png','data:image/png;base64,aW1hZ2U=','javascript:alert(1)']){
  const result=await render({entries:[{asset:{kind:'X',destination_id:'x',visual_url:source,body:'Text'}}]});
  const graphic=flatten(result.entries).find(n=>n.tag==='img');
  if(source.startsWith('javascript:'))assert.equal(graphic,undefined);else assert.equal(graphic.src,source);
 }
});
test('review preserves decisions/history and permits editorial override while delivery still rejects unsupported recipients',async()=>{
 let state={phase:'PUBLICATION_REVIEW',scan:{},destinations:[{id:'journal'}],assets:{journal:{asset:{kind:'EMAIL',destination_id:'journal',subject:'Idea',body:'Saved body'},fingerprint:'saved'}},decisions:{journal:{decision:'REJECT'}},deliveries:{},events:[],editorial_versions:{journal:[{asset:{kind:'EMAIL',destination_id:'journal',body:'Previous body'},fingerprint:'previous'}]}};
 let version=1;
 const adapter={read:async()=>({version,value:structuredClone(state)}),compareAndSwap:async(_key,prior,next)=>{assert.equal(prior,version);version++;state=structuredClone(next);return true;}};
 const store=new CampaignStore(adapter),workflow=new ReviewWorkflow({store,adapter,notify:async()=>{throw Error('NO_EMAILS');},baseUrl:'https://review.example'});
 workflow.authenticate=async()=>true;
 const original=structuredClone(state),view=await workflow.view('campaign');
 assert.equal(view.entries.length,1);assert.equal(view.history[0].asset.body,'Previous body');assert.deepEqual(state,original);
 await workflow.decide('campaign',null,null,'journal','APPROVE','saved');assert.equal(state.decisions.journal.decision,'APPROVE');
 await assert.rejects(store.claimDelivery('campaign','journal'),/VERIFIED_RECIPIENT_REQUIRED/);assert.deepEqual(state.deliveries,{});
 await workflow.decide('campaign',null,null,'journal','REJECT','saved');assert.equal(state.decisions.journal.decision,'REJECT');assert.deepEqual(state.assets,original.assets);assert.deepEqual(state.editorial_versions,original.editorial_versions);
});

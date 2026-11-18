// Synthetic, offline provenance for legacy fixtures testing a later V3 stage.
// The production gate itself is exercised with raw scan and page fixtures.
const {createHash}=require('node:crypto');
const policy=require('../../vendor/emradar-v3-authoritative/src/claim-evidence.cjs');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const scanFixture={artifact_sha256:'a'.repeat(64),snapshot_date:'2026-10-10'};
function checkedDocument(document={},scan=scanFixture){
 if(document.claim_gate)return document;
 const evidence=(document.evidence??[{id:'e1',fact:'A test source reported an industrial proposal.',verified:true}]).map(item=>({
  ...item,record_id:item.record_id??item.id.split(':')[0],
  source_url:item.source_url??'https://synthetic-source.example/article',excerpt:item.excerpt??item.fact??'Synthetic offline test excerpt.',page_sha256:item.page_sha256??'b'.repeat(64)
 }));
 const records=document.records??[];
 const content={...document,evidence,records};
 return {...content,claim_gate:{version:policy.VERSION,scan_sha256:scan.artifact_sha256,document_sha256:hash(content)}};
}
function checkedAsset(asset,document){
 if(asset.review_status==='NEEDS_REVISION')return asset;
 asset.evidence_ids??=document.evidence.slice(0,1).map(item=>item.id);
 asset.story_record_id??=document.evidence.find(item=>asset.evidence_ids.includes(item.id))?.record_id;
 return policy.bindClaimEvidence(asset,document);
}
function checkedState(state){
 state.scan={...scanFixture,...state.scan};
 state.preparation_input={document:checkedDocument(state.preparation_input?.document,state.scan)};
 return state;
}
async function checkedPrepare(store,id,assets){
 const state=await store.mutate(id,checkedState);
 return store.prepare(id,assets.map(asset=>checkedAsset(asset,state.preparation_input.document)));
}
function mockDraftCheck(openai){
 const create=openai.chat.completions.create;
 return {...openai,chat:{...openai.chat,completions:{create:async request=>{
  if(request.messages[0].content.startsWith('Check every material assertion'))return {choices:[{message:{content:'{"supported":true}'}}]};
  return create(request);
 }}}};
}
function checkedProviders(create,options){
 const provider=create({...options,openai:mockDraftCheck(options.openai)});
 const withDocument=worker=>input=>{
  const scan={...scanFixture,...input.scan};
  return worker({...input,scan,document:checkedDocument(input.document,scan)});
 };
 return {...provider,write:withDocument(provider.write),renderVisual:withDocument(provider.renderVisual)};
}
module.exports={checkedDocument,checkedAsset,checkedState,checkedPrepare,mockDraftCheck,checkedProviders};

import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import claimPolicy from '../vendor/emradar-v3-authoritative/src/claim-evidence.cjs';
import {MemoryAdapter} from '../vendor/emradar-v3-authoritative/src/adapters/memory.js';
import {createClaimEvidenceProvider,readArticleBody} from '../vendor/emradar-v3/src/claim-evidence-provider.js';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {createPreparationRun} from '../vendor/emradar-v3/src/preparation-run.js';
import {createPublicationReviewHandoff} from '../vendor/emradar-v3/src/publication-review-handoff.js';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {assetFingerprint,sha256} from '../vendor/emradar-v3/src/contracts.js';
import {normalizePublishedEvidence} from '../vendor/emradar-v3/src/scan-evidence-adapter.js';
import {quarantineSavedProposals,quarantineUnverifiedAssets} from '../vendor/emradar-v3/src/claim-quarantine.js';
import approvalVerifier from '../src/emradar-v3-approval-verifier.cjs';

const excerpt='The port authority opened its first electric cargo berth on Monday. The berth can connect one docked cargo vessel to shore power at a time.';
const fact='The port authority opened one electric cargo berth with capacity for one vessel at a time.';
const page=readArticleBody('<title>Port authority release</title><article><p>'+excerpt+'</p><p>The port authority says vessels must reserve a connection before arrival. The other two cargo berths cannot supply shore power because their substations have yet to be connected.</p></article>');
const replacement='https://independent.example/port';
const primary='https://port.example/release';
const lost='https://subscriber.example/report';
const finding='Ships need to reserve the only available shore-power connection before arrival.';
const caveat='The wider market formation remains under investigation.';
const from='sean@emradar.net';
const fakeScan={snapshot_date:'2026-11-17',artifact_sha256:'1'.repeat(64)};
const source=(url,fact)=>({url,fact,date:'2026-11-17'});
const record=(id,evidence)=>({id,theme:'Unverified regional monopoly',status:'CONFIRMED',causal_chain:{consequences:['Guaranteed monopoly']},evidence});
const weak=record('weak',[source(lost,'All regional ports will be sold next month.')]);
const useful=record('port',[source(primary,fact),source(lost,'The monopoly is already legally binding.')]);
const raw={records:[weak,useful],evidence:[{verified:true,fact:'pre-marked injection'}]};
const assess=async({claims,pages})=>({
 supported:claims.map(claim=>({id:claim.id,status:'SUPPORTED',url:pages[0].url,excerpt:claim.id.endsWith(':0')&&claim.id.startsWith('port')?excerpt:'A long hallucinated excerpt that appears in no downloaded page.'})),
 story:{significant:true,claim_ids:[claims[0].id],headline:'The first electric cargo berth opens',finding,industries:['Ports'],
  relationships:[{cause:'Only one cargo berth has shore power',effect:'Ships must reserve the available connection',mechanism:'Connection capacity is limited to one docked vessel',evidence_ids:[claims[0].id]}],
  scenarios:[{status:'UNRESOLVED_QUESTION',proposition:'Reservation pressure may persist until more substations are connected',evidence_ids:[claims[0].id],missing_evidence:['Reservation utilisation']}]}
});
const gateFor=options=>claimPolicy.createClaimEvidenceGate({
 readPage:async url=>url===primary||url===replacement?page:null,
 findSources:async()=>[replacement],assess,checkAngle:async()=>true,...options
});
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001','hex'),Buffer.alloc(17),Buffer.from('49454e4400000000','hex')]);
const originalAsset=(campaign='dry-run',id='x')=>({campaign_id:campaign,destination_id:id,kind:id==='x'?'X':'EMAIL',subject:'Only one shore-power connection',body:finding+' '+caveat,from,evidence_ids:['port:0'],story_record_id:'port',review_status:'READY'});

test('downloaded body extraction rejects preview, paywall, challenge and hidden text',()=>{
 const teaser='<p>This lengthy search result preview describes a development without presenting the accessible full text. '.repeat(4)+'</p>';
 assert.equal(readArticleBody('<title>News</title><meta property="og:description" content="'+excerpt+'">'+teaser),null);
 assert.equal(readArticleBody('<title>News</title><script type="application/ld+json">{"isAccessibleForFree":false}</script><article>'+teaser+'</article>'),null);
 assert.equal(readArticleBody('<title>Just a moment</title><article>'+teaser+'</article>'),null);
 assert.equal(readArticleBody('<title>News</title><article><div hidden>'+teaser+'</div></article>'),null);
 assert.equal(readArticleBody('<title>News</title><article>'+teaser+'<p>Subscribe to continue reading the complete article now.</p></article>'),null);
 assert.ok(page.text.includes(excerpt));
});

test('drops fabricated excerpts and dependent conclusions, tries the next formation and caps investigations',async()=>{
 const urls=[];
 const gate=gateFor({readPage:async url=>{urls.push(url);return url===primary||url===replacement?page:null;},maxInvestigations:2});
 const document=await gate({scan:fakeScan,document:normalizePublishedEvidence({...raw,records:[...raw.records,record('held',[source('https://held.example/case',fact)])]})});
 assert.deepEqual(document.claim_audit.map(x=>x.status),['NO_SUPPORTED_SIGNIFICANT_ANGLE','ADMITTED','BUDGET_HELD']);
 assert.deepEqual(document.evidence.map(x=>[x.id,x.verified,x.source_url]),[['port:0',true,primary]]);
 assert.deepEqual(document.records.map(item=>item.status),['INVESTIGATE']);
 assert.equal(document.records[0].causal_chain.relationships[0].mechanism,'Connection capacity is limited to one docked vessel');
 assert.equal(document.records[0].scenarios[0].status,'UNRESOLVED_QUESTION');
 assert.doesNotMatch(JSON.stringify(document.records),/monopoly|CONFIRMED/);
 assert.equal(urls.filter(url=>url===lost).length,1);
 assert.equal(urls.includes('https://held.example/case'),false);
 assert.equal(claimPolicy.hasCheckedDocument(document,fakeScan),true);
 assert.equal(claimPolicy.hasCheckedDocument({...document,evidence:[]},fakeScan),false);
 assert.equal(claimPolicy.hasCheckedDocument(document,{...fakeScan,artifact_sha256:'2'.repeat(64)}),false);
});

test('admits a significant causal formation without inventing an alternative scenario',async()=>{
 const noScenario=await gateFor({assess:async input=>{const result=await assess(input);return {...result,story:{...result.story,
  context:{world_change:[{text:'The port opened its first electric cargo berth',evidence_ids:[input.claims[0].id]}],pressures:[],bottlenecks:[],connected_companies:[],consequences:[]},scenarios:[]}};}})({scan:fakeScan,document:normalizePublishedEvidence(raw)});
 assert.equal(noScenario.records.length,1);
 assert.deepEqual(noScenario.records[0].scenarios,[]);
 assert.equal(noScenario.records[0].causal_chain.world_change[0].evidence_ids[0],'port:0');
});

test('discards unsupported competing explanations and consequences instead of making them admission requirements',async()=>{
 const checked=await gateFor({assess:async input=>{const result=await assess(input);return {...result,story:{...result.story,
  context:{consequences:[{text:'Every terminal will close',evidence_ids:['missing']}],world_change:[],pressures:[],bottlenecks:[],connected_companies:[]},
  scenarios:[{status:'COMPETING_EXPLANATION',proposition:'A monopoly caused the berth opening',evidence_ids:['missing'],missing_evidence:[]}]}};}})({scan:fakeScan,document:normalizePublishedEvidence(raw)});
 assert.equal(checked.records.length,1);
 assert.deepEqual(checked.records[0].causal_chain.consequences,[]);
 assert.deepEqual(checked.records[0].scenarios,[]);
 assert.doesNotMatch(JSON.stringify(checked),/Every terminal|monopoly caused/);
});

test('requires a fetched independent replacement and exact support; a search hit alone never passes',async()=>{
 const document=normalizePublishedEvidence({records:[record('port',[source(lost,fact)])]});
 const verified=await gateFor()({scan:fakeScan,document});
 assert.deepEqual(verified.evidence.map(e=>e.source_url),[replacement]);
 const unavailable=await gateFor({readPage:async()=>null})({scan:fakeScan,document});
 assert.equal(unavailable.claim_audit[0].status,'SOURCE_INACCESSIBLE');
 assert.equal(unavailable.evidence.length,0);
 const recap=await gateFor({checkAngle:async()=>false})({scan:fakeScan,document});
 assert.equal(recap.evidence.length,0);
 const outage=await gateFor({assess:async()=>{throw Error('PROVIDER_TIMEOUT');}})({scan:fakeScan,document});
 assert.equal(outage.claim_audit[0].status,'EVIDENCE_CHECK_FAILED');
 assert.equal(outage.records.length,0);
});

test('production search client ignores bare generated URL and enforces the tool budget',async()=>{
 let searched=0;
 const output=[{type:'web_search_call',action:{sources:[{url:replacement}]}},{type:'message',content:[{type:'output_text',text:'https://invented.example/news'}]}];
 const openai={responses:{create:async request=>{searched++;assert.equal(request.max_tool_calls,3);return {output};}}};
 const called=[];
 const verify=createClaimEvidenceProvider({openai,maxToolCalls:3,maxInvestigations:1,readPage:async url=>{called.push(url);return url===replacement?page:null;},
  complete:async(instructions,input)=>input.pages?assess(input):{supported:true}});
 const document=normalizePublishedEvidence({records:[record('port',[source(lost,fact)])]});
 const result=await verify({scan:fakeScan,document});
 assert.equal(searched,1);
 assert.deepEqual(called,[lost,replacement]);
 assert.equal(result.evidence[0].source_url,replacement);
});

test('actual intake and preparation validate scan SHA, gate before router/writer, and stop for review',async()=>{
 const adapter=new MemoryAdapter(),store=new CampaignStore(adapter);
 const bytes=Buffer.from(JSON.stringify({...raw,snapshot_date:fakeScan.snapshot_date,publication_state:"PUBLISHED"}));
 const snapshotDate=fakeScan.snapshot_date,expectedSha256=createHash('sha256').update(bytes).digest('hex');
 const origin='https://emerging-markets-radar.onrender.com';
 const archiveUrl=origin+'/data/checkpoints/discovery-'+snapshotDate+'.json';
 const input={snapshotDate,expectedSha256,archiveUrl,
  publicationRecord:{snapshot_date:snapshotDate,publication_state:'PUBLISHED',public_verification:{artifact_sha256:expectedSha256,verification_contract:'live-reader-exact-identity-v2',archive_data_url:archiveUrl},gates:{public_snapshot_verification:'PASS'},downstream_release_allowed:true},
  releaseAttestation:{snapshot_date:snapshotDate,source_sha256:expectedSha256,publication_state:'PUBLISHED',downstream_release_allowed:true,native_gates:{publication:'PASS'},attested_by:'AUTHORIZED_SOURCE_RELEASE_REVIEW',campaign_authority:{required_stop:'PUBLICATION_REVIEW',external_publication_allowed:false},source_path:'data/checkpoints/discovery-'+snapshotDate+'.json'}};
 const stages=[];
 const prepare=createPreparationRun({store,fetcher:async()=>({ok:true,arrayBuffer:async()=>bytes}),
  verifyClaims:async args=>{stages.push('gate');return gateFor()(args);},
  discover:async({document})=>{stages.push('route');assert.equal(document.records[0].id,'port');return [{id:'x',contact_verified:true,evidence:{ids:['port:0']}}];},
  write:async({campaignId,document})=>{stages.push('write');return claimPolicy.bindClaimEvidence(originalAsset(campaignId),document);},
  renderVisual:async()=>({bytes:png})
 });
 await assert.rejects(prepare({...input,expectedSha256:'a'.repeat(64)}),/UNTRUSTED_HISTORICAL_RELEASE/);
 assert.deepEqual(stages,[]);
 const result=await prepare(input);
 assert.deepEqual(stages,['gate','route','write']);
 const state=(await adapter.read(result.campaignId)).value;
 assert.equal(state.phase,'PUBLICATION_REVIEW');
 assert.equal(state.preparation_input.document.records[0].causal_chain.relationships[0].evidence_ids[0],'port:0');
 assert.equal(state.preparation_input.document.records[0].scenarios[0].status,'UNRESOLVED_QUESTION');
 assert.ok(claimPolicy.hasAssetClaimEvidence(state,state.assets.x.asset));
 assert.deepEqual(state.decisions,{});
 assert.deepEqual(state.deliveries,{});
 assert.equal((await prepare(input)).status,'ALREADY_PREPARED');
 assert.deepEqual(stages,['gate','route','write']);
});

test('held intake never sends an invitation or invokes a router or writer',async()=>{
 const store=new CampaignStore(new MemoryAdapter());
 const bytes=Buffer.from(JSON.stringify(raw)),expectedSha256=createHash('sha256').update(bytes).digest('hex');
 const origin='https://emerging-markets-radar.onrender.com';
 const unexpected=()=>assert.fail('downstream work ran for a held scan');
 const prepare=createPreparationRun({store,fetcher:async()=>({ok:true,arrayBuffer:async()=>bytes}),
  verifyClaims:gateFor({readPage:async()=>null}),discover:unexpected,write:unexpected,renderVisual:unexpected});
 const handoff=createPublicationReviewHandoff({prepare,workflow:{issue:unexpected}});
 const input={snapshotDate:fakeScan.snapshot_date,expectedSha256,liveUrl:origin+'/live',archiveUrl:origin+'/archive'};
 const result=await handoff(input);
 assert.equal(result.status,'CLAIM_EVIDENCE_HELD');
 assert.equal((await store.adapter.read(result.campaignId)).value.claim_gate_attempt.status,'NO_VERIFIED_ANGLE');
 assert.equal((await handoff(input)).status,'CLAIM_EVIDENCE_HELD');
});

test('production writer denies caller-asserted verified flags and drops an unsupported draft',async()=>{
 const checked=await gateFor()({scan:fakeScan,document:normalizePublishedEvidence(raw)});
 let writes=0;
 const generated={subject:'Regional monopoly signed',body:finding+' '+caveat,analytical_finding:finding,limitations:caveat,story_evidence_ids:['port:0']};
 const openai={chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify(++writes===1?generated:{supported:false})}}]})}}};
 const {write}=createOpenAiPreparationProviders({openai});
 const destination={id:'x',contact_verified:true,evidence:{ids:['port:0']}};
 await assert.rejects(write({campaignId:'dry-run',destination,document:normalizePublishedEvidence(raw),scan:fakeScan}),/V3_CHECKED_CLAIM_EVIDENCE_REQUIRED/);
 assert.equal(writes,0);
 await assert.rejects(write({campaignId:'dry-run',destination,document:checked,scan:fakeScan}),/V3_DRAFT_CLAIMS_UNSUPPORTED/);
 assert.equal(writes,2);
});

test('quarantine is idempotent, invalidates unsent group approvals and leaves sent and ambiguous items byte-identical',async()=>{
 const next=id=>{const asset=originalAsset('dry-run',id);return {asset,fingerprint:assetFingerprint(asset)};};
 const state={id:'dry-run',phase:'PUBLICATION_REVIEW',assets:{legacy:next('legacy'),sent:next('sent'),ambiguous:next('ambiguous')},
  email_groups:{group:{id:'group',destination_ids:['legacy','sent'],version:1}},group_approvals:{group:{decision:'APPROVE'}},
  decisions:{legacy:{decision:'APPROVE',group_id:'group'},sent:{decision:'APPROVE',group_id:'group'}},
  deliveries:{sent:{status:'ACCEPTED',receipt:{id:'sent-receipt'}},ambiguous:{status:'AMBIGUOUS'}},events:[]};
 const before=structuredClone(state);
 const adapter=new MemoryAdapter(),store=new CampaignStore(adapter);
 await adapter.compareAndSwap(state.id,null,state);
 const pool={query:async()=>({rows:[{campaign_id:state.id}]})};
 const report=await quarantineSavedProposals({pool,store});
 const after=(await adapter.read(state.id)).value;
 assert.deepEqual(report,[{campaignId:state.id,proposals:[{destination_id:'legacy',previous_fingerprint:before.assets.legacy.fingerprint,approval_invalidated:true}]}]);
 assert.equal(after.assets.legacy.asset.review_status,'NEEDS_REVISION');
 assert.equal(after.decisions.legacy,undefined);
 assert.equal(after.group_approvals.group,undefined);
 assert.deepEqual(after.editorial_versions.legacy[0].asset,before.assets.legacy.asset);
 assert.deepEqual(after.assets.sent,before.assets.sent);
 assert.deepEqual(after.assets.ambiguous,before.assets.ambiguous);
 assert.deepEqual(after.decisions.sent,before.decisions.sent);
 assert.deepEqual(after.deliveries,before.deliveries);
 assert.deepEqual(quarantineUnverifiedAssets(after),[]);
 assert.deepEqual(await quarantineSavedProposals({pool,store}),[]);
});

test('approval, stored proof tampering, and isolated transport replay fail closed',async()=>{
 const adapter=new MemoryAdapter(),store=new CampaignStore(adapter),campaign='dry-run';
 const document=await gateFor()({scan:fakeScan,document:normalizePublishedEvidence(raw)});
 const ready=claimPolicy.bindClaimEvidence(originalAsset(campaign),document);
 const asset={...ready,body:ready.body+' Every terminal has completed expansion.'};
 const fingerprint=assetFingerprint(asset);
 const approval={authority:'OWNER',decision:'APPROVE',campaign_id:campaign,destination_id:'x',asset_sha256:fingerprint};
 const idempotency_key=sha256([campaign,'x',fingerprint]);
 const state={scan:fakeScan,preparation_input:{document},phase:'PUBLICATION_REVIEW',assets:{x:{asset,fingerprint}},
  destinations:[{id:'x'}],decisions:{x:approval},deliveries:{},events:[]};
 await adapter.compareAndSwap(campaign,null,state);
 await assert.rejects(store.decide(campaign,'x','APPROVE',fingerprint),/V3_ASSET_CLAIM_EVIDENCE_REQUIRED/);
 await assert.rejects(store.claimDelivery(campaign,'x'),/V3_ASSET_CLAIM_EVIDENCE_REQUIRED/);
 const check=approvalVerifier.createV3ApprovalVerifier({pool:{query:async()=>({rows:[{payload:{...state,deliveries:{x:{status:'ATTEMPTING',idempotency_key}}}}]})}});
 await assert.rejects(check({campaign_id:campaign,destination_id:'x',asset,approval,idempotency_key}),/V3_ASSET_CLAIM_EVIDENCE_REQUIRED/);
});

test('a mismatched figure is blocked even if a judge returns a real quotation',async()=>{
 const document=normalizePublishedEvidence({records:[record('port',[source(primary,'The berth can connect 12 vessels at a time.')])]});
 const checked=await gateFor()({scan:fakeScan,document});
 assert.deepEqual(checked.evidence,[]);
 assert.equal(checked.claim_audit[0].claims[0].status,'UNRESOLVED');
});

test('an unsupported recheck holds an unchanged unsent draft and archives its prior approval',async()=>{
 const {proposalBinding}=await import('../vendor/emradar-v3/src/proposal-verification.js');
 const adapter=new MemoryAdapter(),store=new CampaignStore(adapter),campaign='dry-run';
 const document=await gateFor()({scan:fakeScan,document:normalizePublishedEvidence(raw)});
 const asset=claimPolicy.bindClaimEvidence(originalAsset(campaign),document),fingerprint=assetFingerprint(asset);
 const approval={authority:'OWNER',decision:'APPROVE',campaign_id:campaign,destination_id:'x',asset_sha256:fingerprint};
 const destination={id:'x'};
 await adapter.compareAndSwap(campaign,null,{scan:fakeScan,preparation_input:{document},phase:'PUBLICATION_REVIEW',
  assets:{x:{asset,fingerprint}},destinations:[destination],decisions:{x:approval},deliveries:{},events:[]});
 await store.recordProposalVerification(campaign,'x',fingerprint,{...proposalBinding({asset,destination,evidence:document.evidence}),id:'recheck',status:'UNSUPPORTED'});
 const state=(await adapter.read(campaign)).value;
 assert.deepEqual(state.editorial_versions.x[0].previous_decision,approval);
 assert.equal(state.decisions.x,undefined);
 await assert.rejects(store.claimDelivery(campaign,'x'),/INCOMPLETE_ASSET_NOT_SENDABLE/);
});

test('PostgreSQL dry-run archives one old approval and leaves sent history byte-identical',async t=>{
 if(!process.env.V3_TEST_DATABASE_URL){t.skip('Disposable V3_TEST_DATABASE_URL required');return;}
 const {Client}=await import('pg');
 const {PostgresAdapter}=await import('../vendor/emradar-v3/src/adapters/postgres.js');
 const client=new Client({connectionString:process.env.V3_TEST_DATABASE_URL});
 await client.connect();
 t.after(()=>client.end());
 // Scope the real SQL sweep to this session, isolated from parallel CI cases.
 await client.query(`CREATE TEMP TABLE v3_campaign_state (
  campaign_id text PRIMARY KEY, version bigint NOT NULL, payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
 )`);
 const adapter=new PostgresAdapter(client),store=new CampaignStore(adapter);
 const campaign='dry-run-postgres';
 const unsent=originalAsset(campaign,'pending'),sent=originalAsset(campaign,'sent');
 const sentEntry={asset:sent,fingerprint:assetFingerprint(sent)};
 const receipt={status:'ACCEPTED',receipt:{provider_id:'historical-id'}};
 const approval={decision:'APPROVE',authority:'OWNER',asset_sha256:assetFingerprint(unsent)};
 const state={phase:'PUBLICATION_REVIEW',assets:{pending:{asset:unsent,fingerprint:assetFingerprint(unsent)},sent:sentEntry},
  deliveries:{sent:receipt},decisions:{pending:approval},events:[]};
 await adapter.compareAndSwap(campaign,null,state);
 const report=await quarantineSavedProposals({pool:client,store});
 assert.equal(report[0].proposals[0].destination_id,'pending');
 const saved=await adapter.read(campaign);
 assert.deepEqual(saved.value.assets.sent,sentEntry);
 assert.deepEqual(saved.value.deliveries.sent,receipt);
 assert.deepEqual(saved.value.editorial_versions.pending[0].previous_decision,approval);
 assert.equal(saved.value.decisions.pending,undefined);
 assert.deepEqual(await quarantineSavedProposals({pool:client,store}),[]);
 assert.equal((await adapter.read(campaign)).version,saved.version);
});

test('visible numbered official releases are full-text evidence; navigation, hidden lists and previews are not',()=>{
 const body='<ol><li><div>'+excerpt+'</div></li><li><div>The port authority says vessels must reserve a connection before arrival. The other two cargo berths cannot supply shore power because their substations have yet to be connected.</div></li></ol>';
 assert.ok(readArticleBody('<title>Official release</title><article>'+body+'</article>').text.includes(excerpt));
 assert.equal(readArticleBody('<title>Official release</title><nav>'+body+'</nav>'),null);
 assert.equal(readArticleBody('<title>Official release</title><article><div hidden>'+body+'</div></article>'),null);
 assert.equal(readArticleBody('<title>Official release</title><article class="preview snippet">'+body+'</article>'),null);
 assert.equal(readArticleBody('<title>Official release</title><article>'+body+'<p>Subscribe to continue reading the complete article now.</p></article>'),null);
});

test('source-reader recovery is once-only, selects inaccessible records and makes no additional web searches',async()=>{
 const {default:restart}=await import('../src/emradar-v3-clean-restart.cjs');
 const bytes=Buffer.from(JSON.stringify(raw)),expectedSha256=createHash('sha256').update(bytes).digest('hex');
 const input={snapshotDate:fakeScan.snapshot_date,expectedSha256,liveUrl:'https://emerging-markets-radar.onrender.com/data/discovery.json',archiveUrl:'https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-'+fakeScan.snapshot_date+'.json'};
 const store=new CampaignStore(new MemoryAdapter());let calls=0;
 const baseGate=gateFor();
 const prepare=createPreparationRun({store,fetcher:async()=>({ok:true,arrayBuffer:async()=>bytes}),verifyClaims:async args=>{
  calls++;
  if(calls===1){
   const output=await claimPolicy.createClaimEvidenceGate({readPage:async()=>null,findSources:async()=>[],assess:async()=>assert.fail('no accessible pages'),checkAngle:async()=>false,maxInvestigations:2})(args);
   return output;
  }
  assert.deepEqual(args.recoverRecordIds,['weak','port']);
  return baseGate(args);
 },discover:async()=>[{id:'x',contact_verified:true,evidence:{ids:['port:0']}}],write:async({campaignId,document})=>claimPolicy.bindClaimEvidence(originalAsset(campaignId),document),renderVisual:async()=>({bytes:png})});
 const first=await prepare(input);assert.equal(first.status,'CLAIM_EVIDENCE_HELD');
 // Simulate an actual pre-upgrade durable campaign, which has no reader revision.
 await store.mutate(first.campaignId,current=>{delete current.claim_gate_attempt.source_reader_revision;return current;});
 assert.equal(restart.recoverableSourceRecords((await store.adapter.read(first.campaignId)).value).length,2);
 const recovered=await prepare(input);assert.equal(recovered.status,'PUBLICATION_REVIEW');
 const saved=(await store.adapter.read(first.campaignId)).value;
 assert.equal(saved.claim_gate_previous.document.claim_audit[0].status,'SOURCE_INACCESSIBLE');
 assert.equal(restart.recoverableSourceRecords(saved),null);
 assert.equal((await prepare(input)).status,'ALREADY_PREPARED');assert.equal(calls,2);
});

test('production source-reader recovery disables paid alternative search and rechecks original body proof',async()=>{
 let searches=0;
 const provider=createClaimEvidenceProvider({openai:{responses:{create:async()=>{searches++;throw Error('MUST_NOT_SEARCH');}}},complete:async(_prompt,payload)=>payload.claims?assess(payload):{supported:true},maxInvestigations:2,maxToolCalls:3,readPage:async url=>url===primary?page:null});
 const result=await provider({scan:fakeScan,document:normalizePublishedEvidence(raw),recoverRecordIds:['port']});
 assert.equal(searches,0);assert.equal(result.evidence.length,1);assert.equal(result.records[0].id,'port');
});

test('independent wording check retains downloaded article identity with the sealed passage',async()=>{
 let inspected=false;
 const api=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async request=>{
  const payload=JSON.parse(request.messages[1].content);inspected=true;
  assert.equal(payload.evidence[0].source,'Port authority release');
  assert.equal(payload.evidence[0].page_sha256,page.sha256);
  assert.equal(payload.evidence[0].excerpt,excerpt);
  return {choices:[{message:{content:'{"supported":false}'}}]};
 }}}}});
 assert.equal(await api.verifyDraft({draft:{subject:'Port',body:'Unsupported expansion'},evidence:[{id:'port:0',fact,source:'Port authority release',source_url:primary,excerpt,page_sha256:page.sha256}]}),false);
 assert.equal(inspected,true);
});


test('production assessor may retain a literal narrower fact with a testable unresolved question',async()=>{
 const bundled='The port authority opened its first electric cargo berth, all vessels converted, and every terminal closed.';
 const narrower='The port authority opened its first electric cargo berth';
 const document=normalizePublishedEvidence({records:[record('port',[source(primary,bundled)])]});
 let checks=0;
 const provider=createClaimEvidenceProvider({openai:{responses:{create:async()=>assert.fail('existing source should avoid web search')}},maxInvestigations:1,maxToolCalls:3,
  readPage:async()=>page,
  complete:async(prompt,input)=>{
   if(input.claims){assert.match(prompt,/passage_id/);assert.ok(input.pages[0].passages[0].text.includes(excerpt));return {supported:[{id:input.claims[0].id,status:'SUPPORTED',url:input.pages[0].url,passage_id:input.pages[0].passages[0].id,verified_fact:narrower}],
    story:{significant:true,claim_ids:[input.claims[0].id],headline:'One electric cargo berth opens',
     finding:'Ships must reserve the only available shore-power connection before arrival.',industries:['ports'],relationships:[],
     investigative_question:'Will berth reservations constrain arriving cargo vessels?',
     scenarios:[{status:'UNRESOLVED_QUESTION',proposition:'Reservations may exceed available connections',evidence_ids:[input.claims[0].id],missing_evidence:['Daily reservations and arrivals']}]}};}
   checks++;assert.match(prompt,/original_fact/);assert.equal(input.evidence[0].fact,narrower);assert.equal(input.evidence[0].original_fact,bundled);return {supported:true};
  }});
 const result=await provider({scan:fakeScan,document});
 assert.equal(checks,1);assert.equal(result.claim_audit[0].claims[0].status,'PARTIAL_SUPPORTED');
 assert.equal(result.records.length,1);assert.equal(result.evidence[0].partial,true);
 assert.doesNotMatch(JSON.stringify(result.records),/every terminal closed|all vessels converted/i);
});

'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {createHash}=require('node:crypto');
const {mergeCurrentPublishedScan,campaignIdFor}=require('../src/emradar-v3-runtime.cjs');
const {restartDate,restartKey,campaignIdentity,retireDisposableCampaigns,retireUnsentApprovals}=require('../src/emradar-v3-clean-restart.cjs');
const scanBytes=Buffer.from(JSON.stringify({snapshot_date:restartDate,publication_state:'PUBLISHED'}));
const expectedSha256=createHash('sha256').update(scanBytes).digest('hex');
const source_path='data/checkpoints/discovery-'+restartDate+'.json';
const origin='https://emerging-markets-radar.onrender.com';
const input={snapshotDate:restartDate,expectedSha256,liveUrl:origin+'/data/discovery.json',archiveUrl:origin+'/'+source_path,
 releaseAttestation:{source_path,snapshot_date:restartDate,source_sha256:expectedSha256,publication_state:'PUBLISHED',
  downstream_release_allowed:true,native_gates:{publication:'PASS'},attested_by:'AUTHORIZED_SOURCE_RELEASE_REVIEW',
  campaign_authority:{external_publication_allowed:false,required_stop:'PUBLICATION_REVIEW'}}};
const response=bytes=>({ok:true,arrayBuffer:async()=>bytes});

test('the authorized release attestation alone requires exact signed archive bytes and refuses explicit denial',async()=>{
 const {verifyPublishedScan}=await import('../vendor/emradar-v3/src/scan-intake.js');
 const accepted=await verifyPublishedScan({...input,fetcher:async()=>response(scanBytes)});
 assert.equal(accepted.scan.artifact_sha256,expectedSha256);
 await assert.rejects(verifyPublishedScan({...input,fetcher:async url=>response(url===input.liveUrl?scanBytes:Buffer.from('{}'))}),/UNVERIFIED_PUBLICATION/);
 await assert.rejects(verifyPublishedScan({...input,releaseAttestation:{...input.releaseAttestation,downstream_release_allowed:false},fetcher:async()=>assert.fail('denial read')}),/UNTRUSTED_HISTORICAL_RELEASE/);
 await assert.rejects(verifyPublishedScan({...input,publicationRecord:{},fetcher:async()=>assert.fail('invalid companion read')}),/UNTRUSTED_HISTORICAL_RELEASE/);
});

test('live scan cannot bypass a blocked sidecar, and the fresh identity is stable and distinct',()=>{
 const unavailable=[];
 unavailable.blocked=[{snapshotDate:restartDate,reason:'PUBLICATION_ATTESTATION_INVALID'}];
 assert.deepEqual(mergeCurrentPublishedScan(unavailable,[input]),[]);
 assert.notEqual(campaignIdFor(input),campaignIdFor({...input,restartKey}));
 assert.equal(campaignIdFor({...input,restartKey}),campaignIdentity(restartDate+':'+expectedSha256,restartKey));
});

test('Postgres retirement preserves sent records, retires only unsent approvals, and is idempotent',async t=>{
 if(!process.env.V3_TEST_DATABASE_URL)return t.skip('Disposable V3_TEST_DATABASE_URL required');
 const {Client}=require('pg');
 const db=new Client({connectionString:process.env.V3_TEST_DATABASE_URL});
 await db.connect();t.after(()=>db.end());
 await db.query('CREATE TEMP TABLE v3_campaign_state (campaign_id text PRIMARY KEY, version bigint, updated_at timestamptz, payload jsonb)');
 await db.query('CREATE TEMP TABLE v3_send_reservations (campaign_id text, destination_id text)');
 const ids=['a','b','c'].map(x=>'v3-'+x.repeat(32));
 const decision={decision:'APPROVE',group_id:'group'};
 const sent={status:'ACCEPTED',receipt:{provider_id:'historical'}};
 const base={scan:{snapshot_date:restartDate},phase:'PUBLICATION_REVIEW',decisions:{pending:decision},assets:{pending:{body:'draft'}},deliveries:{}};
 const mixed={...base,group_approvals:{group:{decision:'APPROVE'}},decisions:{...base.decisions,sent:decision},deliveries:{sent}};
 for(const [i,payload] of [base,mixed,base].entries())await db.query('INSERT INTO v3_campaign_state VALUES($1,1,now(),$2)',[ids[i],payload]);
 assert.deepEqual(await retireDisposableCampaigns(db,ids[2]),[ids[0]]);
 assert.equal(await retireUnsentApprovals(db,ids[2]),1);
 const {rows}=await db.query('SELECT payload FROM v3_campaign_state ORDER BY campaign_id');
 assert.equal(rows[0].payload.phase,'CLOSED');
 assert.deepEqual(rows[0].payload.retirement.decisions,base.decisions);
 assert.deepEqual(rows[1].payload.deliveries,mixed.deliveries);
 assert.deepEqual(rows[1].payload.decisions,{sent:decision});
 assert.deepEqual(rows[1].payload.retired_unsent_approvals,{pending:decision});
 assert.deepEqual(rows[2].payload,base);
 assert.deepEqual(await retireDisposableCampaigns(db,ids[2]),[]);
 assert.equal(await retireUnsentApprovals(db,ids[2]),0);
});

test('recovery selects only the strongest supported angle interrupted by a provider failure, once',()=>{
 const {recoverableRecord,recoverableRecords}=require('../src/emradar-v3-clean-restart.cjs');
 const make=(record_id,status,count)=>({record_id,status,claims:Array.from({length:count},()=>({status:'SUPPORTED'}))});
 const state={phase:'SCAN_VERIFIED',claim_gate_attempt:{status:'NO_VERIFIED_ANGLE'},preparation_input:{document:{evidence:[],claim_audit:[
  make('weak','EVIDENCE_CHECK_FAILED',1),make('rejected','NO_SUPPORTED_SIGNIFICANT_ANGLE',3),make('best','EVIDENCE_CHECK_FAILED',2)
 ]}}};
 assert.equal(recoverableRecord(state,restartKey),'best');
 assert.deepEqual(recoverableRecords(state,restartKey),['best','weak']);
 assert.equal(recoverableRecord({...state,claim_gate_previous:{}},restartKey),null);
 assert.equal(recoverableRecord(state),null);
});

test('restart copy uses the checked angle verbatim and rejects missing claim links or tampering',async()=>{
 const {writeCheckedRestartDraft}=await import('../vendor/emradar-v3/src/openai-preparation-providers.js');
 const {checkedDocument}=require('./fixtures/v3-claim-fixtures.cjs');
 const proof=require('../vendor/emradar-v3-authoritative/src/claim-evidence.cjs');
 const scan={artifact_sha256:expectedSha256,snapshot_date:restartDate};
 const theme='A financing mechanism for cleaner textile production';
 const finding='The announced fund combines equipment finance with technical assistance for suppliers.';
 const evidence=[{id:'e1',record_id:'r',verified:true,fact:finding}];
 const document=checkedDocument({records:[{id:'r',theme,why_surfaced:finding}],evidence},scan);
 const fixture={campaignId:'restart',document,scan};
 const destination={id:'x',evidence:{ids:['e1']}};
 const x=writeCheckedRestartDraft({...fixture,destination});
 assert.ok(x.body.includes(finding));assert.ok(x.body.includes('remains under investigation'));
 assert.equal(x.subject,theme);
 assert.ok(proof.hasAssetClaimEvidence({scan,preparation_input:{document}},x));
 const email=require('./fixtures/v3-verified-recipient.cjs')('journal',evidence);
 const asset=writeCheckedRestartDraft({...fixture,destination:{...email,evidence:{ids:['e1']}}});
 assert.ok(asset.body.includes(finding));assert.ok(proof.hasAssetClaimEvidence({scan,preparation_input:{document}},asset));
 assert.throws(()=>writeCheckedRestartDraft({...fixture,destination:{...destination,evidence:{ids:['different']}}}),/V3_CHECKED_ANGLE_REQUIRED/);
 assert.throws(()=>writeCheckedRestartDraft({...fixture,destination,document:{...document,records:[]}}),/V3_CHECKED_CLAIM_EVIDENCE_REQUIRED/);
});

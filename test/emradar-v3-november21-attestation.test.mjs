import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyPublishedScan,publicationRecordValid,releaseAttestationValid} from '../vendor/emradar-v3/src/scan-intake.js';

const fixture=name=>readFileSync(new URL(`./fixtures/${name}-2026-11-21.json`,import.meta.url));
const bytes=fixture('discovery');
const publication=JSON.parse(fixture('publication'));
const release=JSON.parse(fixture('downstream-release-attestation'));
const date='2026-11-21',sha='709ce5ead1e5b34a190db9a31835ab58d9c0a2fa1a5bcd90c19489171759cff5';
const archiveUrl=`https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-${date}.json`;
const input={snapshotDate:date,expectedSha256:sha,archiveUrl,liveUrl:'https://emerging-markets-radar.onrender.com/data/discovery.json',publicationRecord:publication,releaseAttestation:release};
const fetcher=async()=>({ok:true,arrayBuffer:async()=>bytes});

test('actual public 21 November bytes and both sidecars meet the signed identity contract',async()=>{
 assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);
 const verified=await verifyPublishedScan({...input,fetcher});
 assert.equal(verified.document.snapshot_date,date);
 assert.equal(verified.scan.artifact_sha256,sha);
});
test('five-gate record rejects missing, conflicting and failed identity or authorization',async()=>{
 for(const change of [
  {source_sha256:'a'.repeat(64)}, {source_path:'data/checkpoints/discovery-2026-11-20.json'},
  {source_blob_sha:'a'.repeat(40)}, {publication_state:'DRAFT'}, {downstream_release_allowed:false},
  {public_reader:'https://example.org'}, {render_deployment_status:'PENDING'},
  {gates:{...publication.gates,exact_archive_bytes:'FAIL'}},
  {public_verification:{verification_contract:'live-reader-exact-identity-v2'}}
 ]){
  const bad={...publication,...change};
  assert.equal(publicationRecordValid(bad,{snapshotDate:date,expectedSha256:sha,archiveUrl,releaseAttestation:release}),false);
  await assert.rejects(verifyPublishedScan({...input,publicationRecord:bad,fetcher}),/UNTRUSTED_HISTORICAL_RELEASE/);
 }
 for(const change of [
  {source_sha256:'a'.repeat(64)}, {source_path:'data/checkpoints/discovery-2026-11-20.json'},
  {campaign_authority:{...release.campaign_authority,campaign_id:'EMRADAR_2026_11_20_LAUNCH'}},
  {campaign_authority:{...release.campaign_authority,external_publication_allowed:true}},
  {native_gates:{...release.native_gates,evidence:'FAIL'}}
 ]){
  const bad={...release,...change};
  assert.equal(releaseAttestationValid(bad,{snapshotDate:date,expectedSha256:sha,modern:true}),false);
  await assert.rejects(verifyPublishedScan({...input,releaseAttestation:bad,fetcher}),/UNTRUSTED_HISTORICAL_RELEASE/);
 }
 await assert.rejects(verifyPublishedScan({...input,releaseAttestation:undefined,fetcher}),/UNTRUSTED_HISTORICAL_RELEASE/);
 assert.equal((await verifyPublishedScan({...input,publicationRecord:undefined,fetcher})).scan.artifact_sha256,sha);
 await assert.rejects(verifyPublishedScan({...input,archiveUrl:'https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-2026-11-20.json',fetcher}),/UNTRUSTED_HISTORICAL_RELEASE|INVALID_HISTORICAL_ARCHIVE/);
 await assert.rejects(verifyPublishedScan({...input,fetcher:async()=>({ok:true,arrayBuffer:async()=>Buffer.from('{}')})}),/UNVERIFIED_PUBLICATION/);
});
test('older exact-identity format still accepts complete matching fields',async()=>{
 const legacy={snapshot_date:date,publication_state:'PUBLISHED',downstream_release_allowed:true,
  public_verification:{verification_contract:'live-reader-exact-identity-v2',artifact_sha256:sha,archive_data_url:archiveUrl},
  gates:{public_snapshot_verification:'PASS'}};
 assert.equal((await verifyPublishedScan({...input,publicationRecord:legacy,fetcher})).scan.artifact_sha256,sha);
});

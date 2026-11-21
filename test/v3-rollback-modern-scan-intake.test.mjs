import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationRecordValid,releaseAttestationValid} from '../vendor/emradar-v3/src/scan-intake.js';
const date='2026-11-21',hash='709ce5ead1e5b34a190db9a31835ab58d9c0a2fa1a5bcd90c19489171759cff5',blob='4d8a8a617d0dfce9ba37ca3d67b9b4aaa41a3d8e';
const source_path='data/checkpoints/discovery-'+date+'.json';
const attestation={snapshot_date:date,source_path,source_sha256:hash,source_blob_sha:blob,publication_state:'PUBLISHED',downstream_release_allowed:true,native_gates:{evidence:'PASS',editorial:'PASS',brand:'PASS',risk:'PASS',publication:'PASS'},attested_by:'AUTHORIZED_SOURCE_RELEASE_REVIEW',campaign_authority:{campaign_id:'EMRADAR_2026_11_21_LAUNCH',required_stop:'PUBLICATION_REVIEW',external_publication_allowed:false}};
const publication={snapshot_date:date,publication_state:'PUBLISHED',source_path,source_sha256:hash,source_blob_sha:blob,downstream_release_allowed:true,render_deployment_status:'LIVE',public_reader:'https://emerging-markets-radar.onrender.com',gates:{exact_current_bytes:'PASS',exact_archive_bytes:'PASS',archive_index:'PASS',dashboard_render:'PASS',exact_commit_deployment:'PASS'}};
const input={snapshotDate:date,expectedSha256:hash,archiveUrl:'https://emerging-markets-radar.onrender.com/'+source_path,releaseAttestation:attestation};
test('21 November five-gate signed archives qualify for legacy engine intake',()=>{
 assert.equal(publicationRecordValid(publication,input),true);
 assert.equal(releaseAttestationValid(attestation,{...input,modern:true}),true);
});
test('missing or mismatched signed publication authorization fails closed',()=>{
 assert.equal(publicationRecordValid({...publication,source_sha256:'0'.repeat(64)},input),false);
 assert.equal(publicationRecordValid({...publication,render_deployment_status:'PENDING'},input),false);
 assert.equal(releaseAttestationValid({...attestation,source_blob_sha:'0'.repeat(40)},{...input,modern:true}),true);
 assert.equal(publicationRecordValid(publication,{...input,releaseAttestation:{...attestation,source_blob_sha:'0'.repeat(40)}}),false);
 assert.equal(releaseAttestationValid({...attestation,downstream_release_allowed:false},{...input,modern:true}),false);
});

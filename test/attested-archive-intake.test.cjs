'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const ARCHIVE='https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-2026-11-19.json';
const DATE='2026-11-19';
const source=Buffer.from(JSON.stringify({snapshot_date:DATE,publication_state:'PUBLISHED',findings:[]}));
const sha=createHash('sha256').update(source).digest('hex');
const attestation={
 snapshot_date:DATE,source_sha256:sha,source_path:'data/checkpoints/discovery-2026-11-19.json',
 publication_state:'PUBLISHED',downstream_release_allowed:true,native_gates:{publication:'PASS'},
 attested_by:'AUTHORIZED_SOURCE_RELEASE_REVIEW',
 campaign_authority:{required_stop:'PUBLICATION_REVIEW',external_publication_allowed:false}
};
const fetcher=async()=>({ok:true,status:200,arrayBuffer:async()=>source});
async function verify(a=attestation,expectedSha256=sha,fetch=fetcher){
 const {verifyPublishedScan}=await import('../vendor/emradar-v3/src/scan-intake.js');
 return verifyPublishedScan({snapshotDate:DATE,expectedSha256,liveUrl:ARCHIVE,archiveUrl:ARCHIVE,releaseAttestation:a,fetcher:fetch});
}
test('attestation-only release verifies immutable archive without current mutable scan',async()=>{
 const result=await verify();
 assert.equal(result.scan.archive_artifact_sha256,sha);
 assert.equal(result.document.snapshot_date,DATE);
});
test('incorrect archive digest fails closed',async()=>{
 await assert.rejects(verify(attestation,'0'.repeat(64)),/UNTRUSTED_HISTORICAL_RELEASE|INVALID_SCAN_IDENTITY/);
});
test('missing attestation cannot use archive-only fallback',async()=>{
 await assert.rejects(verify(undefined),/UNTRUSTED_SCAN_HOST|SCAN_HTTP|INVALID_SCAN_IDENTITY/);
});
test('contradictory campaign authority fails closed',async()=>{
 await assert.rejects(verify({...attestation,campaign_authority:{...attestation.campaign_authority,external_publication_allowed:true}}),/UNTRUSTED_HISTORICAL_RELEASE/);
});
test('tampered archive bytes fail exact SHA-256 comparison',async()=>{
 const tampered=Buffer.from(JSON.stringify({snapshot_date:DATE,publication_state:'PUBLISHED',findings:['tampered']}));
 await assert.rejects(verify(attestation,sha,async()=>({ok:true,status:200,arrayBuffer:async()=>tampered})),/SCAN_ARTIFACT|SHA|IDENTITY|MISMATCH/i);
});

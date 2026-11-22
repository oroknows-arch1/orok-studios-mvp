const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'src/emradar-v3-runtime.cjs'),'utf8');

test('retired October replacement is never re-run during V3 startup',()=>{
  for(const text of [server,runtime]){
    assert.doesNotMatch(text,/replacementPending|runReplacementReview|V3_REPLACEMENT_REVIEW_FAILED/);
    assert.doesNotMatch(text,/group-first-review-2026-10-25-v1/);
  }
});
test('fresh ordinary campaigns and owner-review recovery still run on startup',()=>{
  assert.match(server,/recoverEditorial\(\);/);
  assert.match(server,/prepareLatest\(\);/);
  assert.match(server,/setInterval\(\(\)=>\{recoverEditorial\(\);prepareLatest\(\);\},60\*60\*1000\)/);
  assert.match(runtime,/const runCampaign=async\(snapshotDate\)=>/);
  assert.match(runtime,/service\.prepareAndNotify\(selected\)/);
  assert.match(runtime,/const runEditorialRecovery=async\(\)=>/);
});
test('recipient delivery and owner approval remain independent of old replacement recovery',()=>{
  assert.match(server,/V3_DISTRIBUTION_CAPABILITIES|V3_ACTIVATION_PREFLIGHT/);
  assert.match(runtime,/runPendingRegenerations/);
  assert.match(runtime,/review:'\+campaignId|review:'\+pendingId/);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acceptPublishedXReceipt, deriveAudienceJobs } = require('../src/audience-intelligence/v3-receipt-adapter.cjs');
const receipt = { ownerApproved:true, distributionState:'PUBLISHED_CONFIRMED', provider:'X',
  xUrl:'https://x.com/oroknows/status/12345', providerPostId:'12345',
  formationId:'formation-1', receiptId:'receipt-1', scanUrl:'https://emradar.net/scan/example',
  sourceIds:['source-1'], digest:'sha256-fixture' };
test('confirmed owner-approved X receipt yields independent non-writing job', () => {
  const before = JSON.stringify(receipt);
  const result = acceptPublishedXReceipt(receipt);
  assert.equal(result.status,'ELIGIBLE_DOWNSTREAM');
  assert.equal(result.job.idempotencyKey,'x:12345');
  assert.equal(result.job.v3WriteAllowed,false);
  assert.equal(result.job.outboundActionAuthorised,false);
  assert.equal(JSON.stringify(receipt),before);
});
test('approval alone, queued delivery and non-X receipts are ignored', () => {
  for (const variant of [
    {...receipt,distributionState:'APPROVED'},
    {...receipt,distributionState:'QUEUED'},
    {...receipt,provider:'EMAIL'},
    {...receipt,ownerApproved:false}
  ]) assert.equal(acceptPublishedXReceipt(variant).status,'IGNORED');
});
test('provider ID mismatch and missing provenance are ignored', () => {
  assert.equal(acceptPublishedXReceipt({...receipt,providerPostId:'999'}).status,'IGNORED');
  assert.equal(acceptPublishedXReceipt({...receipt,sourceIds:[]}).status,'IGNORED');
});
test('duplicate receipt observations yield one job', () => {
  const result = deriveAudienceJobs([receipt,{...receipt,receiptId:'another-observation'}]);
  assert.equal(result.jobs.length,1);
});

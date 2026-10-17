'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {verifyDevelopmentHarness} = require('../scripts/verify-development-harness.cjs');

test('repository development harness enforces the active objective and distribution stop', () => {
  assert.deepEqual(verifyDevelopmentHarness(), {
    status: 'HARNESS_VERIFIED',
    objective_id: 'emradar-v3-complete-existing-campaign',
    campaign_id: 'v3-df5b240c718018880410c03a4c392d64'
  });
});


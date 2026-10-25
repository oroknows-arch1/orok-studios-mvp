'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {verifyDevelopmentHarness} = require('../scripts/verify-development-harness.cjs');

test('repository development harness enforces the active objective and distribution stop', () => {
  assert.deepEqual(verifyDevelopmentHarness(), {
    status: 'HARNESS_VERIFIED',
    objective_id: 'emradar-v3-final-marketing-signoff',
    campaign_id: 'v3-df5b240c718018880410c03a4c392d64',
    v3_source: {
      repository: 'oroknows-arch1/emradar-marketing-engine-v3',
      commit: 'c730670b5aea37338bd6e2ea8d1bd10afebdebb5'
    }
  });
});


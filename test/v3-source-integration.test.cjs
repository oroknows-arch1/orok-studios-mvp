'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {verifyV3SourceIntegration} = require('../scripts/verify-v3-source-integration.cjs');

const root = path.resolve(__dirname, '..');
const load = relative => import(pathToFileURL(path.join(root, relative)).href);

test('VC harness pins and verifies the authorised V3 source checkout', () => {
  const result = verifyV3SourceIntegration();
  assert.equal(result.status, 'V3_SOURCE_INTEGRATED');
  assert.equal(result.repository, 'oroknows-arch1/emradar-marketing-engine-v3');
  assert.equal(result.commit, 'a92267f41c00d60a5a8080a6c83911a0d9269e6b');
  assert.equal(result.authorised_submodules, 1);
  assert.deepEqual(Object.keys(result.shared).sort(), ['src/discovery.js','src/review-access.js']);
  assert.deepEqual(Object.keys(result.authoritativeStandards).sort(),['src/discovery-coverage.js','src/editorial-reference.js','src/graphic-renderer.js','src/graphic-standard.js']);
});

test('source boundary excludes every unapproved repository integration', () => {
  const result=verifyV3SourceIntegration();
  assert.equal(result.authorised_submodules,1);
  assert.equal(result.repository,'oroknows-arch1/emradar-marketing-engine-v3');
});

test('authoritative source and production overlay retain executable core compatibility', async () => {
  const [sourceContracts,overlayContracts,sourceDiscovery,overlayDiscovery] = await Promise.all([
    load('vendor/emradar-v3-authoritative/src/contracts.js'),
    load('vendor/emradar-v3/src/contracts.js'),
    load('vendor/emradar-v3-authoritative/src/discovery.js'),
    load('vendor/emradar-v3/src/discovery.js')
  ]);
  const scan={snapshot_date:'2026-10-18',artifact_sha256:'a'.repeat(64),live_artifact_sha256:'a'.repeat(64),archive_artifact_sha256:'a'.repeat(64),publication_verified:true};
  assert.deepEqual(sourceContracts.assertScan(scan),overlayContracts.assertScan(scan));
  assert.equal(sourceContracts.sha256({b:2,a:1}),overlayContracts.sha256({a:1,b:2}));
  assert.deepEqual(sourceContracts.STATES,overlayContracts.STATES);
  assert.deepEqual(sourceContracts.DELIVERY,overlayContracts.DELIVERY);
  const input={scan,document:{evidence:[{id:'e1',verified:true}]},history:[]};
  const sourceResult=await sourceDiscovery.createDiscovery({loadCandidates:async()=>[]})(input);
  const overlayResult=await overlayDiscovery.createDiscovery({loadCandidates:async()=>[]})(input);
  assert.deepEqual(sourceResult,overlayResult);
});

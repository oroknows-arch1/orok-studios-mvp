'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Detect the known dangerous coupling in PR #27.
test('owner review must not await downstream audience work', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /await\s+(?:[\w$.]+\.)?runPendingThreads\s*\(/,
    'Downstream thread work cannot block owner review');
  assert.doesNotMatch(server, /await\s+(?:[\w$.]+\.)?runGrok(?:Research|Scout|Audience)\s*\(/i,
    'Grok work cannot block owner review');
});

test('V3 source must not import downstream audience code', () => {
  const root = path.join(__dirname, '..', 'vendor', 'emradar-v3');
  if (!fs.existsSync(root)) return;
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) :
    /\.[cm]?js$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
  for (const file of walk(root)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /require\s*\(\s*['"][^'"]*(?:emradar-grok|emradar-audience|emradar-x-thread)/,
      'Protected V3 source cannot import downstream audience code: ' + file);
  }
});

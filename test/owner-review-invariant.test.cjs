'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Guard against the known PR #27 regression: audience work awaited in the
// same startup/polling path as V3 campaign preparation.
test('protected owner review never awaits downstream audience thread processing', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /await\\s+(?:[\\w$.]+\\.)?runPendingThreads\\s*\\(/,
    'Downstream thread work must not be awaited by the V3 server');
  assert.doesNotMatch(server, /await\\s+(?:[\\w$.]+\\.)?runGrok(?:Research|Scout|Audience)\\s*\\(/i,
    'Grok must not be awaited in the V3 server');
});

test('protected V3 source does not import downstream audience modules', () => {
  const root = path.join(__dirname, '..', 'vendor', 'emradar-v3');
  if (!fs.existsSync(root)) return;
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) :
    /\\.[cm]?js$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
  for (const file of walk(root)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /require\\s*\\(\\s*['"][^'"]*(?:emradar-grok|emradar-audience|emradar-x-thread)/,
      'Protected V3 source cannot import downstream audience code: ' + file);
  }
});

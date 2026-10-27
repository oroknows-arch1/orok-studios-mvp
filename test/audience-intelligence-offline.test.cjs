'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectCandidates } = require('../src/audience-intelligence/offline-scout.cjs');
const discovery = {
  published: true, url: 'https://emradar.net/research/example',
  formationId: 'formation-1', digest: 'sha256-fixture', evidenceState: 'FORMING',
  sourceIds: ['source-1'], limitation: 'No procurement award established',
  keywords: ['battery', 'storage', 'procurement'], audiences: ['energy developers']
};
const post = (id, text, views = 0) => ({
  id, url: `https://x.com/example/status/${id}`, author: 'example',
  origin: 'outside', createdAt: '2026-10-27T00:00:00Z',
  observedAt: '2026-10-27T01:00:00Z', text, views, isReply: false
});
test('blocks unverified or unpublished discoveries', () => {
  assert.equal(selectCandidates({ ...discovery, published: false }, [post('1', 'battery storage')]).status, 'BLOCKED');
  assert.equal(selectCandidates({ ...discovery, sourceIds: [] }, [post('1', 'battery storage')]).status, 'BLOCKED');
});
test('rejects unrelated viral posts and retains relevant low-view posts', () => {
  const result = selectCandidates(discovery, [post('1', 'viral unrelated topic', 1000000), post('2', 'battery storage planning', 100)]);
  assert.deepEqual(result.candidates.map(x => x.id), ['2']);
});
test('deduplicates and excludes replies', () => {
  const result = selectCandidates(discovery, [post('1', 'battery storage'), post('1', 'battery storage'), {...post('2','battery storage'), isReply:true}]);
  assert.equal(result.candidates.length, 1);
});
test('unknown view count stays unknown', () => {
  const result = selectCandidates(discovery, [post('1','battery storage', null)]);
  assert.equal(result.candidates[0].views, null);
  assert.equal(result.candidates[0].starred, false);
});
test('candidate never becomes approved or publishable', () => {
  const result = selectCandidates(discovery, [post('1','battery storage', 12000)]);
  assert.equal(result.candidates[0].status, 'NEEDS_HUMAN_RELEVANCE_REVIEW');
  assert.equal(result.candidates[0].starred, true);
});

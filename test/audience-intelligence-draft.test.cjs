'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectCandidates } = require('../src/audience-intelligence/offline-scout.cjs');
const { prepareDraft } = require('../src/audience-intelligence/offline-draft.cjs');
const discovery = {
  published: true, url: 'https://emradar.net/research/example',
  formationId: 'f-1', digest: 'fixture-sha', evidenceState: 'FORMING',
  sourceIds: ['s-1'], limitation: 'Procurement awards have not been verified.',
  keywords: ['battery', 'storage'], audiences: ['developers']
};
const posts = [{
  id: '123', url: 'https://x.com/example/status/123', author: 'example',
  origin: 'watchlist', createdAt: '2026-10-27T00:00:00Z',
  observedAt: '2026-10-27T01:00:00Z', text: 'battery storage',
  views: 7000, isReply: false
}];
const candidate = selectCandidates(discovery, posts).candidates[0];
test('produces source-mapped draft with limitation and review stop', () => {
  const result = prepareDraft(discovery, candidate, {
    claim: 'Four-hour battery storage procurement is under consideration.',
    sourceIds: ['s-1']
  });
  assert.equal(result.status, 'DRAFT_REQUIRES_OWNER_REVIEW');
  assert.equal(result.publishAuthorised, false);
  assert.match(result.text, /Procurement awards have not been verified/);
  assert.match(result.text, /https:\/\/emradar.net/);
  assert.deepEqual(result.claims[0].sourceIds, ['s-1']);
});
test('blocks source IDs outside the verified discovery', () => {
  assert.equal(prepareDraft(discovery, candidate, {
    claim: 'A claim', sourceIds: ['unknown']
  }).status, 'BLOCKED');
});
test('blocks unpublished discovery and unreviewed candidate', () => {
  assert.equal(prepareDraft({...discovery,published:false},candidate,{claim:'A claim',sourceIds:['s-1']}).status,'BLOCKED');
  assert.equal(prepareDraft(discovery,{...candidate,status:'APPROVED'}, {claim:'A claim',sourceIds:['s-1']}).status,'BLOCKED');
});

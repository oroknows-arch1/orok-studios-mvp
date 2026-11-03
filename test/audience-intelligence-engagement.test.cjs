'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEngagementQueue } = require('../src/audience-intelligence/engagement-queue.cjs');
const anchor = { published: true, postId: '100', formationId: 'formation-1', url: 'https://x.com/emradar/status/100' };
const candidate = { id: '200', formationId: 'formation-1', author: 'energyjournalist',
  url: 'https://x.com/energyjournalist/status/200', origin: 'outside',
  status: 'NEEDS_HUMAN_RELEVANCE_REVIEW', sourceIds: ['s1'], observedAt: '2026-10-28T00:00:00Z' };
test('published anchor generates review-only engagement suggestions', () => {
  const result = buildEngagementQueue(anchor, [candidate]);
  assert.equal(result.status, 'REVIEW_QUEUE');
  assert.deepEqual(result.items[0].suggestedActions, ['REVIEW_CONVERSATION','CONSIDER_REPLY','CONSIDER_FOLLOW']);
  assert.equal(result.items[0].actionAuthorised, false);
  assert.equal(result.items[0].replyText, null);
});
test('unpublished anchor cannot activate queue', () => {
  assert.equal(buildEngagementQueue({...anchor,published:false},[candidate]).status,'BLOCKED');
});
test('excludes unrelated formations, self-posts and duplicates', () => {
  const result = buildEngagementQueue(anchor, [candidate,candidate,{...candidate,id:'100'},{...candidate,id:'300',formationId:'other'}]);
  assert.equal(result.items.length,1);
});
test('no candidate can be treated as already authorised', () => {
  const result = buildEngagementQueue(anchor, [{...candidate,actionAuthorised:true}]);
  assert.equal(result.items[0].actionAuthorised,false);
  assert.equal(result.items[0].state,'PENDING_HUMAN_REVIEW');
});

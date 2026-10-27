'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcileObservations } = require('../src/audience-intelligence/conversation-monitor.cjs');
const anchor = {published:true,postId:'100',formationId:'formation-1'};
const obs = {postId:'200',formationId:'formation-1',account:'energywriter',kind:'reply',observedAt:'2026-10-28T01:00:00Z',likes:4,views:undefined};
test('new relevant reply produces review suggestion but no action', () => {
  const result = reconcileObservations(anchor,[],[obs]);
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].history[0].views,null);
  assert.equal(result.recommendations[0].action,'REVIEW_REPLY');
  assert.equal(result.recommendations[0].authorised,false);
});
test('repeated observation is idempotent and older observations ignored', () => {
  const first = reconcileObservations(anchor,[],[obs]);
  const second = reconcileObservations(anchor,first.records,[obs,{...obs,observedAt:'2026-10-27T01:00:00Z'}]);
  assert.equal(second.recommendations.length,0);
  assert.deepEqual(second.records,first.records);
});
test('newer observation retains history without modifying input', () => {
  const first = reconcileObservations(anchor,[],[obs]);
  const prior = JSON.stringify(first.records);
  const next = reconcileObservations(anchor,first.records,[{...obs,observedAt:'2026-10-28T02:00:00Z',likes:7}]);
  assert.equal(next.records[0].history.length,2);
  assert.equal(JSON.stringify(first.records),prior);
  assert.equal(next.recommendations[0].followSuggestion,null);
});
test('rejects unrelated, self and unpublished observations', () => {
  const result = reconcileObservations(anchor,[],[{...obs,formationId:'other'},{...obs,postId:'100'}]);
  assert.equal(result.records.length,0);
  assert.equal(reconcileObservations({...anchor,published:false},[],[obs]).status,'BLOCKED');
});

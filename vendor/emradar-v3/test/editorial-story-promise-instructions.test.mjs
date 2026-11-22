import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const providerSource=readFileSync(new URL('../src/openai-preparation-providers.js',import.meta.url),'utf8');

// The isolated Google CI checkout does not contain the linked authoritative
// graphic-renderer repository. Verify prompt contracts without importing a
// graphic-rendering dependency or making a model call.
test('upstream claim repair requires source scrutiny and recipient-visible qualifications',()=>{
 assert.match(providerSource,/UPSTREAM CLAIM REPAIR/);
 assert.match(providerSource,/original attributable source passages/);
 assert.match(providerSource,/actual recipient-facing body/);
 assert.match(providerSource,/remove the assertion/);
 assert.match(providerSource,/do not offer an article claiming findings/i);
});
test('final check emphasises narrative, legitimate uncertainty and deliverable promise',()=>{
 assert.match(providerSource,/FINAL STORY AND PROMISE/);
 assert.match(providerSource,/outlet fit is genuine/);
 assert.match(providerSource,/clearly framed uncertainties are legitimate article questions/);
 assert.match(providerSource,/article promise is deliverable/);
 assert.match(providerSource,/unsupported factual assertion/);
});

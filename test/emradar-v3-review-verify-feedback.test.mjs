import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPage} from '../vendor/emradar-v3/src/review-page.js';

test('Verify Again updates the owner status with the actual saved verification outcome',()=>{
 assert.match(reviewPage,/const result=await api\('verify'/);
 assert.match(reviewPage,/await refresh\(\);\s*status\.textContent=verificationFeedback\(result\)/);
 assert.match(reviewPage,/result\?\.explanation/);
 assert.match(reviewPage,/New verification completed/);assert.match(reviewPage,/Existing verified research reused/);
});

test('individual and group Verify Again use the same action and expose errors',()=>{
 assert.match(reviewPage,/verifyCurrent\(verify,item\)/);
 assert.match(reviewPage,/verifyCurrent\(verify,member\)/);
 assert.match(reviewPage,/Verify Again failed/);
 assert.match(reviewPage,/error\.reference/);
});

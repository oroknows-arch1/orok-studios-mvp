'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('V3 production request dispatcher forwards every authenticated review API route',()=>{
 const runtime=fs.readFileSync(path.join(__dirname,'../src/emradar-v3-runtime.cjs'),'utf8');
 const http=fs.readFileSync(path.join(__dirname,'../vendor/emradar-v3/src/http.js'),'utf8');
 const match=runtime.match(/const REVIEW_PATHS=new Set\(\[([^\]]+)\]\)/);
 assert.ok(match,'production dispatcher must declare review paths');
 const paths=new Set([...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1]));
 assert(!paths.has('/api/review/verify'),'per-proposal repeat verification has been retired');
 for(const name of ['group-revise','group-member','view','decision','revise','release']){
  const route='/api/review/'+name;
  assert.ok(http.includes("'"+route+"'"),'review backend must implement '+route);
  assert.ok(paths.has(route),'production dispatcher must forward '+route+' instead of serving HTML');
 }
});

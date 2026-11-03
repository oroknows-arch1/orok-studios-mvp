'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { attestFromPublishedBytes } = require('../src/audience-intelligence/evidence-attestation.cjs');
const bytes = Buffer.from('published-fixture');
const sha = createHash('sha256').update(bytes).digest('hex');
const snapshot = { campaign_id:'v3-fixture',payload:{
 scan:{artifact_sha256:sha,source_key:'2026-10-28:'+sha},
 decisions:{x:{authority:'OWNER',decision:'APPROVE',destination_id:'x',campaign_id:'v3-fixture',asset_sha256:'asset-sha'}},
 assets:{x:{fingerprint:'asset-sha'}},
 deliveries:{x:{status:'ACCEPTED',receipt:{accepted:true}}}
}};
const input = {publishedBytes:bytes,scanUrl:'https://emradar.net/scan',formationId:'f',sourceIds:['s']};
test('published bytes and actual owner decision are required',()=>{
 assert.equal(attestFromPublishedBytes(snapshot,input).attested,true);
 assert.equal(attestFromPublishedBytes(snapshot,{...input,publishedBytes:Buffer.from('tampered')}).attested,false);
 assert.equal(attestFromPublishedBytes({...snapshot,payload:{...snapshot.payload,decisions:{x:{...snapshot.payload.decisions.x,decision:'REJECT'}}}},input).attested,false);
});
test('missing published bytes and mismatched owner asset cannot attest',()=>{
 assert.equal(attestFromPublishedBytes(snapshot,{...input,publishedBytes:null}).attested,false);
 assert.equal(attestFromPublishedBytes({...snapshot,payload:{...snapshot.payload,assets:{x:{fingerprint:'different'}}}},input).attested,false);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMediaVerifier,sha256}=require('../src/emradar-audience-media-verifier.cjs');
const bytes=Buffer.from('image-bytes-for-test'),media={preview_url:'https://emradar.net/assets/a.png',sha256:sha256(bytes)};
test('validates bytes from trusted loader against approved digest',async()=>{
 const verify=createMediaVerifier({loadTrustedMedia:async()=>({bytes})});
 const result=await verify(media);assert.equal(result.verified,true);assert.equal(result.sha256,media.sha256);
});
test('rejects substituted image bytes',async()=>{
 const verify=createMediaVerifier({loadTrustedMedia:async()=>({bytes:Buffer.from('changed')})});
 assert.equal((await verify(media)).reason,'MEDIA_HASH_MISMATCH');
});
test('rejects external and credential-bearing origins before loading',async()=>{
 let calls=0;const verify=createMediaVerifier({loadTrustedMedia:async()=>{calls++;return {bytes}}});
 assert.equal((await verify({...media,preview_url:'https://other.example/image.png'})).reason,'MEDIA_ORIGIN_UNTRUSTED');
 assert.equal((await verify({...media,preview_url:'https://user:pass@emradar.net/a.png'})).reason,'MEDIA_ORIGIN_UNTRUSTED');
 assert.equal(calls,0);
});
test('rejects missing or oversized bytes',async()=>{
 const verify=createMediaVerifier({loadTrustedMedia:async()=>({bytes}),maxBytes:4});
 assert.equal((await verify(media)).reason,'MEDIA_BYTES_UNAVAILABLE');
});

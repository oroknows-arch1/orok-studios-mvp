'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function createMediaVerifier({loadTrustedMedia,allowedOrigins=['https://emradar.net'],maxBytes=8000000}={}){
 if(typeof loadTrustedMedia!=='function'||!Array.isArray(allowedOrigins)||!allowedOrigins.length)throw Error('MEDIA_VERIFIER_CONFIG_INVALID');
 return async function verifyMedia(media){
  if(media==null)return {verified:true,sha256:null};
  if(typeof media.preview_url!=='string'||!/^[a-f0-9]{64}$/.test(media.sha256||''))return {verified:false,reason:'MEDIA_METADATA_INVALID'};
  let url;try{url=new URL(media.preview_url)}catch{return {verified:false,reason:'MEDIA_URL_INVALID'}}
  if(url.protocol!=='https:'||url.username||url.password||!allowedOrigins.includes(url.origin))return {verified:false,reason:'MEDIA_ORIGIN_UNTRUSTED'};
  const record=await loadTrustedMedia({url:url.href,expected_sha256:media.sha256});
  if(!record||!(Buffer.isBuffer(record.bytes)||record.bytes instanceof Uint8Array)||record.bytes.length===0||record.bytes.length>maxBytes)return {verified:false,reason:'MEDIA_BYTES_UNAVAILABLE'};
  const digest=sha256(record.bytes);
  if(!equal(digest,media.sha256))return {verified:false,reason:'MEDIA_HASH_MISMATCH'};
  return {verified:true,sha256:digest,byte_length:record.bytes.length};
 };
}
module.exports={createMediaVerifier,sha256};

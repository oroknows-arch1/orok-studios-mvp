'use strict';
const {assetHash}=require('./emradar-audience-asset-hash.cjs');
const escapeHtml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function prepareVisualReview({campaign_id,review_id,source_sha256,segments}={}){
 if(!campaign_id||!review_id||!source_sha256||!Array.isArray(segments)||!segments.length)throw Error('VISUAL_REVIEW_INVALID');
 const problems=[],cards=[];
 for(let i=0;i<segments.length;i++){
  const s=segments[i];
  if(s?.sequence!==i+1||typeof s.text!=='string'||!s.text.trim())throw Error('VISUAL_REVIEW_SEGMENT_INVALID');
  const media=s.media??null;
  // A preview must be backed by an immutable, reviewed image URL plus matching SHA.
  if(media&&(typeof media.preview_url!=='string'||!/^https:\/\//.test(media.preview_url)||!/^[a-f0-9]{64}$/.test(media.sha256||'')))problems.push({sequence:s.sequence,reason:'GRAPHIC_PREVIEW_OR_HASH_MISSING'});
  if(media&&media.media_ids?.length&&media.media_ids.length!==1)problems.push({sequence:s.sequence,reason:'MEDIA_PREVIEW_COUNT_UNSUPPORTED'});
  cards.push({...s,media,asset_sha256:assetHash(s)});
 }
 const ready=problems.length===0;
 const html='<section class="emradar-x-review" data-review="'+escapeHtml(review_id)+'"><h2>X thread — complete owner preview</h2><p>'+cards.length+' posts in publication order. Approval '+(ready?'available after authenticated owner verification.':'unavailable: missing visual evidence.')+'</p>'+
 cards.map(s=>'<article class="x-post" data-sequence="'+s.sequence+'"><h3>Post '+s.sequence+' — '+escapeHtml(s.kind||'DISCOVERY')+'</h3><p style="white-space:pre-wrap">'+escapeHtml(s.text)+'</p>'+(s.media?.preview_url?'<img alt="Approved graphic preview for post '+s.sequence+'" src="'+escapeHtml(s.media.preview_url)+'" loading="lazy"/>':'')+'<small>Asset SHA-256: '+escapeHtml(s.asset_sha256)+'</small></article>').join('')+
 (problems.length?'<p role="alert">Approval blocked: '+escapeHtml(problems.map(x=>'post '+x.sequence+': '+x.reason).join('; '))+'</p>':'')+'</section>';
 return {campaign_id,review_id,source_sha256,segments:cards,problems,ready_for_authenticated_approval:ready,html};
}
module.exports={prepareVisualReview};

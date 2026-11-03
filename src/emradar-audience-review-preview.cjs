'use strict';
const {createHash}=require('node:crypto');
const {draftFullScanThread,previewThreadHtml}=require('./emradar-x-thread-drafts.cjs');
const {buildDiscoveryCoverage}=require('./emradar-grok-discovery-coverage.cjs');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function prepareAudienceReview({document,scanUrl,post_id='0'}={}){
 const thread=draftFullScanThread({document,scanUrl});
 const manifest=buildDiscoveryCoverage({document,post_id,body:thread.segments[0].text});
 if(thread.record_count!==manifest.discovery_count||thread.record_ids.some((id,i)=>id!==manifest.discovery_ids[i]))throw Error('AUDIENCE_REVIEW_COVERAGE_MISMATCH');
 const review_id=hash({snapshot_date:document.snapshot_date,source_sha256:manifest.source_sha256,segments:thread.segments});
 return {review_id,source_sha256:manifest.source_sha256,thread,coverage:{discovery_count:manifest.discovery_count,record_ids:manifest.discovery_ids},html:previewThreadHtml(thread),state:'PREVIEW_ONLY'};
}
module.exports={prepareAudienceReview};

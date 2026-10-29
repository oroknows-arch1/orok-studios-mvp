'use strict';
const {createHash}=require('node:crypto');
function assetHash(segment){
 if(!segment||!Number.isInteger(segment.sequence)||segment.sequence<1||typeof segment.text!=='string'||!segment.text.trim())throw Error('AUDIENCE_ASSET_INVALID');
 return createHash('sha256').update(JSON.stringify({
  sequence:segment.sequence,kind:segment.kind??null,record_id:segment.record_id??null,
  text:segment.text,media:segment.media??null,
  source_links:segment.source_links??[],parent_sequence:segment.parent_sequence??null
 })).digest('hex');
}
module.exports={assetHash};

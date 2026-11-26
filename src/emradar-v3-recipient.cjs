'use strict';
const {isIP}=require('node:net');
const crypto=require('node:crypto');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function validRecipient(value){
 if(typeof value!=='string'||value.length>254||value!==value.trim()||/[\r\n,;<>\s]/.test(value))return false;
 const parts=value.split('@');
 if(parts.length!==2||parts[0].length>64||!parts[0]||parts[0].startsWith('.')||parts[0].endsWith('.')||parts[0].includes('..')||!/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+$/.test(parts[0]))return false;
 const domain=parts[1];
 return !isIP(domain)&&domain.includes('.')&&domain.split('.').every(label=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))&&!/\.(?:local|localhost|internal|invalid)$/i.test(domain);
}
function assertRecipientAllowed(asset,...records){
 if(!validRecipient(asset?.to))throw Error('V3_VALID_RECIPIENT_REQUIRED');
 if([asset,...records].filter(Boolean).some(record=>record.opted_out===true||record.do_not_contact===true||record.contact?.opted_out===true||record.contact?.do_not_contact===true))throw Error('V3_RECIPIENT_OPTED_OUT');
 return asset.to;
}
function assertSendableRecipient(asset,destination,approval){
 if(approval?.authority!=='OWNER'||approval?.decision!=='APPROVE'||approval.campaign_id!==asset.campaign_id||approval.destination_id!==asset.destination_id||approval.asset_sha256!==digest(asset))throw Error('V3_OWNER_APPROVAL_REQUIRED');
 return assertRecipientAllowed(asset,destination);
}
async function checkPersistedRecipient(pool,asset,state){
 const destination=state?.destinations?.find(d=>d.id===asset.destination_id);
 const approval=state?.decisions?.[asset.destination_id];
 assertSendableRecipient(asset,destination,approval);
 const {rows}=await pool.query("SELECT record FROM v3_outlet_directory WHERE outlet_id=$1 OR lower(record->'contact'->>'email')=lower($2)",[asset.destination_id,asset.to]);
 return assertRecipientAllowed(asset,destination,...rows.map(row=>row.record));
}
module.exports={validRecipient,assertRecipientAllowed,assertSendableRecipient,checkPersistedRecipient};

'use strict';
const {isIP}=require('node:net');
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
function authoritativeUrl(value,website){
 try{const u=new URL(value),site=new URL(website);return u.protocol==='https:'&&site.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname.replace(/^www\./,'')===site.hostname.replace(/^www\./,'');}catch{return false;}
}
function authoritativeContact(record){
 if(authoritativeUrl(record?.contact?.source_url,record?.website))return true;
 const path=record?.contact?.publisher_attribution;if(!Array.isArray(path)||!path.length||path.length>2)return false;
 let previous=record.website;
 for(const edge of path){
  if(!authoritativeUrl(edge.from_url,previous)||!/^[a-f0-9]{64}$/.test(edge.page_sha256??'')||!/contact|editor|publisher|about/i.test(edge.link_text??''))return false;
  try{const u=new URL(edge.to_url);if(u.protocol!=='https:'||u.username||u.password||u.port)return false;}catch{return false;}
  previous=edge.to_url;
 }
 return previous===record.contact.source_url;
}
function isDirectoryIdentityText(text){return typeof text==='string'&&/\bpublisher\b|\bpublishing\b|\b(?:press|media|editorial|newspaper|magazine)\s+(?:association|council|group|company|directory)\b/i.test(text)&&!/email marketing|lead generation|buy (?:contact|email)|data broker/i.test(text);}
function directoryContact(record){
 const c=record?.contact,p=c?.directory_attribution,v=record?.verification;
 if(v?.method!=='published_editorial_directory'||!p)return false;
 return authoritativeUrl(p.publication_url,record.website)&&p.publication_name===record.name&&
  authoritativeUrl(p.identity_url,c.source_url)&&v.publication_proof_url===c.source_url&&
  v.publication_page_sha256===c.page_sha256&&/^[a-f0-9]{64}$/.test(p.identity_sha256??'')&&
  typeof p.entry_excerpt==='string'&&p.entry_excerpt.toLowerCase().includes(c.email?.toLowerCase())&&p.entry_excerpt.toLowerCase().includes(record.name?.toLowerCase())&&
  isDirectoryIdentityText(p.identity_excerpt);
}
function isCommercialContactContext(text){return typeof text==='string'&&/\bfor commodity offers\b|\b(?:sales|trading|supplier) (?:enquiries|inquiries)\b|\brequest (?:a )?(?:quote|quotation)\b/i.test(text);}
function verifiedDestination(record){
 const c=record?.contact,v=record?.verification;
 return record?.active===true&&record.editorial_fit_verified===true&&record.contact_verified===true&&validRecipient(c?.email)&&
 ((v?.method==='live_editorial_contact_page'&&authoritativeContact(record)&&authoritativeUrl(v?.publication_proof_url,record.website))||directoryContact(record))&&v?.status==='VERIFIED'&&
 ['editorial','submissions','named_editor','general'].includes(c.purpose)&&
 typeof c.published_excerpt==='string'&&c.published_excerpt.toLowerCase().includes(c.email.toLowerCase())&&/^[a-f0-9]{64}$/.test(c.page_sha256??'')&&
 Array.isArray(v.evidence_ids)&&v.evidence_ids.length>0&&/^[a-f0-9]{64}$/.test(v.scan_evidence_digest??'')&&
 !isCommercialContactContext(c.published_excerpt)&&!record.opted_out&&!record.do_not_contact&&!c.opted_out&&!c.do_not_contact;
}
function assertVerifiedDestination(record){if(!verifiedDestination(record))throw Error('V3_VERIFIED_RECIPIENT_REQUIRED');return record;}
function assertVerifiedAsset(asset,destination){
 assertVerifiedDestination(destination);assertRecipientAllowed(asset,destination);
 if(asset.to.toLowerCase()!==destination.contact.email.toLowerCase()||asset.contact_status!=='VERIFIED'||asset.delivery_eligible!==true||
 !asset.evidence_ids?.length||!asset.evidence_ids.some(id=>(destination.evidence?.ids??destination.verification.evidence_ids).includes(id)))throw Error('V3_VERIFIED_RECIPIENT_REQUIRED');
 return asset.to;
}
async function checkPersistedRecipient(pool,asset,state){
 const destination=state?.destinations?.find(d=>d.id===asset.destination_id);
 assertVerifiedAsset(asset,destination);
 const {rows}=await pool.query("SELECT record FROM v3_outlet_directory WHERE outlet_id=$1 OR lower(record->'contact'->>'email')=lower($2)",[asset.destination_id,asset.to]);
 const current=rows.find(row=>row.record.id===asset.destination_id)?.record;
 assertVerifiedAsset(asset,current);
 return assertRecipientAllowed(asset,destination,...rows.map(row=>row.record));
}
module.exports={isCommercialContactContext,isDirectoryIdentityText,validRecipient,assertRecipientAllowed,checkPersistedRecipient,verifiedDestination,assertVerifiedDestination,assertVerifiedAsset};

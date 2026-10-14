import {sha256,MAX_DESTINATIONS} from './contracts.js';

const normalized=value=>String(value??'').trim().toLowerCase();
export function selectDestinations({candidates,scanEvidence,history=[],limit=MAX_DESTINATIONS}) {
 if(!Array.isArray(candidates)||!Array.isArray(scanEvidence)||!Array.isArray(history)||!Number.isInteger(limit)||limit<1||limit>MAX_DESTINATIONS) throw Error('INVALID_DISCOVERY_INPUT');
 const evidenceIds=new Set(scanEvidence.filter(e=>e?.id&&e.verified===true).map(e=>e.id));
 const prior=new Map();
 for(const item of history) {
  if(!item?.destination_id) continue;
  const old=prior.get(item.destination_id);
  if(!old){prior.set(item.destination_id,{...item});continue;}
  const oldTime=Date.parse(old.last_contacted_at??'')||0;
  const newTime=Date.parse(item.last_contacted_at??'')||0;
  const recent=newTime>=oldTime?item:old;
  prior.set(item.destination_id,{
   ...recent,
   opted_out:old.opted_out===true || item.opted_out===true,
   do_not_contact:old.do_not_contact===true || item.do_not_contact===true,
   status:old.status==='PENDING_REPLY'||item.status==='PENDING_REPLY'?'PENDING_REPLY':recent.status,
   last_contacted_at:newTime>oldTime?item.last_contacted_at:old.last_contacted_at
  });
 }
 const eligible=[];
 const seen=new Set();
 for(const candidate of candidates) {
  if(!candidate?.id || seen.has(candidate.id)) continue;
  seen.add(candidate.id);
  const linked=(candidate.evidence_ids??[]).filter(id=>evidenceIds.has(id));
  if(!linked.length || candidate.contact_verified!==true || candidate.editorial_fit_verified!==true || candidate.active!==true) continue;
  if(!candidate.contact || !candidate.contact.source_url || !candidate.contact.checked_at) continue;
  const previous=prior.get(candidate.id);
  if(previous?.do_not_contact===true || previous?.opted_out===true || previous?.status==='PENDING_REPLY') continue;
  const repeat=Boolean(previous?.last_scan_digest && candidate.scan_digest && previous.last_scan_digest===candidate.scan_digest);
  if(repeat) continue;
  const recency=previous?.last_contacted_at ? Date.parse(previous.last_contacted_at):0;
  const relevance=Math.min(linked.length,4);
  eligible.push({...candidate,linked_evidence:linked,relevance,last_contacted_at:Number.isFinite(recency)?recency:0});
 }
 eligible.sort((a,b)=>b.relevance-a.relevance || a.last_contacted_at-b.last_contacted_at || a.id.localeCompare(b.id));
 const selected=eligible.slice(0,limit).map(({id,category,contact,linked_evidence,editorial_fit_verified})=>({
  id,category,contact,evidence:{ids:linked_evidence},contact_verified:true,editorial_fit_verified
 }));
 return {selected,excluded_count:candidates.length-selected.length,selection_digest:sha256(selected)};
}
export function verifyEditorialAsset(asset,{evidenceIds,requiredXVisual=true}={}) {
 if(!asset || !asset.destination_id || !asset.campaign_id || typeof asset.body!=='string' || !asset.body.trim()) throw Error('EDITORIAL_ASSET_INVALID');
 if(!['EMAIL','X'].includes(asset.kind)) throw Error('UNSUPPORTED_ASSET_KIND');
 if(!Array.isArray(asset.evidence_ids) || !asset.evidence_ids.length || !asset.evidence_ids.every(id=>evidenceIds.has(id))) throw Error('EDITORIAL_EVIDENCE_UNVERIFIED');
 if(asset.kind==='EMAIL' && (!asset.subject?.trim() || !asset.from)) throw Error('EDITORIAL_EMAIL_INCOMPLETE');
 if(asset.kind==='EMAIL' && asset.delivery_eligible===true && (!asset.to || asset.contact_status!=='VERIFIED')) throw Error('EDITORIAL_EMAIL_INCOMPLETE');
 if(asset.kind==='EMAIL' && asset.delivery_eligible!==true && (asset.to || asset.contact_status!=='UNVERIFIED')) throw Error('EDITORIAL_DRAFT_CONTACT_STATUS_INVALID');
 if(asset.kind==='X' && requiredXVisual && (!asset.visual_sha256 || !/^[a-f0-9]{64}$/.test(asset.visual_sha256))) throw Error('X_VISUAL_REQUIRED');
 return {fingerprint:sha256(asset),evidence_ids:asset.evidence_ids};
}

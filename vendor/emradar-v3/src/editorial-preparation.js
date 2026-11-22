import {randomUUID} from 'node:crypto';
import emailBrand from '../../../src/email-brand.cjs';
import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {sha256, assetFingerprint} from './contracts.js';
import {proposalBinding} from './proposal-verification.js';

export const recoveryCampaignId = 'v3-ee0ca7e9f07c03189d961df231589882';
export const editorialApplies = state => Boolean(state?.editorial_preparation || state?.id === recoveryCampaignId);
export const isEditorialReady = status => ['READY_VERIFIED', 'CORRECTED_READY'].includes(status);
const recoverySources = {
 'vietnam-vung-ang-rental-factory-2026': [
  'https://xuctiendautu.hatinhso.vn/vi/bai-viet/ha-tinh-chap-thuan-dau-tu-du-an-khu-nha-xuong-cho-thue-vung-ang-voi-tong-von-75-ty-dong'
 ],
 'uzbekistan-fergana-hospital-ppp-2026': [
  'https://gov.uz/en/ssv/sections/view/20263',
  'https://www.ebrd.com/home/work-with-us/projects/psd/57386.html'
 ]
};
const evidenceFor = state => state.preparation_input?.document?.evidence ?? [];
const destinationFor = (state, id) => state.destinations.find(item => item.id === id);
const bindingFor = (state, asset) => proposalBinding({asset, destination: destinationFor(state, asset.destination_id), evidence: evidenceFor(state)});
const matches = (record, binding) => Object.entries(binding).every(([key, value]) => record?.[key] === value);

export function hasEditorialOutcome(state, id) {
 if (state.deliveries?.[id] || state.decisions?.[id]?.decision === 'EXCLUDE') return true;
 const entry = state.assets[id];
 return Boolean(entry && matches(state.editorial_preparation?.outcomes?.[id], bindingFor(state, entry.asset)));
}

export function editorialStatus(state, id) {
 const entry = state.assets[id];
 if (state.decisions?.[id]?.decision === 'EXCLUDE') return 'EXCLUDED';
 if (state.deliveries?.[id]) return 'HISTORICAL';
 if (!editorialApplies(state)) return entry?.asset.review_status === 'NEEDS_REVISION' ? 'INVESTIGATION_REQUIRED' : 'LEGACY';
 const record = state.editorial_preparation?.outcomes?.[id];
 if (!entry || !matches(record, bindingFor(state, entry.asset))) return 'INVESTIGATION_REQUIRED';
 if (isEditorialReady(record.status) && (entry.asset.review_status === 'NEEDS_REVISION' ||
   (entry.asset.kind === 'X' && !(entry.asset.visual_url || entry.asset.visual_base64)) ||
   (entry.asset.kind === 'EMAIL' && (entry.asset.contact_status !== 'VERIFIED' || !recipientPolicy.recipientReadyForReview(entry.asset, destinationFor(state, id)))))) return 'INVESTIGATION_REQUIRED';
 return record.status;
}

const contentKey = asset => sha256([asset.kind, asset.subject ?? '', asset.body, asset.brand_version ?? null, [...(asset.evidence_ids ?? [])].sort()]);
const proposalText = asset => ({kind:asset.kind, subject:asset.subject ?? '', body:asset.body});
const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function usableCheck(check, pages, destinationId) {
 const material = Array.isArray(check?.claims) ? check.claims.filter(claim => claim?.material !== false) : [];
 return check?.status === 'VERIFIED' && check.deliverable === true &&
   check.fit?.[destinationId] === true && material.length > 0 &&
   material.every(claim => claim?.status === 'VERIFIED' && typeof claim.text === 'string' && claim.text.trim() &&
     Array.isArray(claim.passages) && claim.passages.length && claim.passages.every(passage =>
       typeof passage?.quote === 'string' && normalize(passage.quote).length >= 24 && pages.some(page => page.url === passage.url && normalize(page.text).includes(normalize(passage.quote))))) &&
   Array.isArray(check.contradictions) && !check.contradictions.some(claim => claim?.material !== false);
}

function reviseText(asset, proposed) {
 if (typeof proposed?.subject !== 'string' || !proposed.subject.trim() || proposed.subject.length > 500 ||
     /[\r\n]/.test(proposed.subject) || typeof proposed?.body !== 'string' || !proposed.body.trim() || proposed.body.length > 50000) return null;
 const revised = {...asset, subject:proposed.subject.trim(), body:proposed.body.trim()};
 if (revised.brand_version && revised.kind === 'EMAIL') {
  revised.body = emailBrand.reviewBody(revised.body.replace(/\n+Sean Walker\nEMRADAR \| Research & Editorial\nsean@emradar\.net(?:\nemradar\.net)?$/i, ''));
  revised.html = emailBrand.render(revised.body);
 }
 return revised;
}

// Each exact draft and its outlet set shares one investigation. Persist outcomes
// after each group so interruption does not discard completed work.
export async function prepareEditorialReview({store, campaignId, readSource, assess, renderRevision, ids=null, checkOnly=false}) {
 const state = (await store.adapter.read(campaignId))?.value;
 if (!state?.preparation_input?.document) throw Error('EDITORIAL_PREPARATION_STATE_REQUIRED');
 const groups = new Map();
 const pageCache = new Map();
 for (const entry of Object.values(state.assets)) {
  const id = entry.asset.destination_id;
  if (state.deliveries?.[id] || state.decisions?.[id]?.decision === 'EXCLUDE') continue;
  const key = contentKey(entry.asset);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(entry);
 }
 const hasSaved = entries => entries.some(({asset}) => state.proposal_verifications?.[asset.destination_id]?.some(record => record.status === 'REVISED_AND_VERIFIED'));
 const orderedGroups = [...groups.values()].sort((a,b) => Number(hasSaved(b)) - Number(hasSaved(a)));
 for (const entries of orderedGroups) {
  if(ids&&!entries.some(({asset})=>ids.includes(asset.destination_id)))continue;
  const pending = entries.filter(({asset}) => !hasEditorialOutcome(state, asset.destination_id));
  if (!pending.length) continue;
  const first = pending[0].asset;
  const evidence = evidenceFor(state).filter(item => first.evidence_ids?.includes(item.id));
  const previous = entries.flatMap(({asset}) => (state.proposal_verifications?.[asset.destination_id] ?? [])
    .filter(record => matches(record, bindingFor(state, asset))));
  const saved = !checkOnly && previous.findLast(record => record.status === 'REVISED_AND_VERIFIED' && record.deliverable === true);
  const priorOutcomes = entries.map(({asset}) => state.editorial_preparation?.outcomes?.[asset.destination_id]).filter(Boolean);
  const related=Object.values(state.assets).filter(({asset})=>first.story_record_id&&asset.story_record_id===first.story_record_id);
  const savedPages = [...priorOutcomes,...related.map(({asset})=>state.editorial_preparation?.outcomes?.[asset.destination_id]).filter(Boolean)].flatMap(outcome => outcome.sources ?? []);
  const relatedSources=related.flatMap(({asset})=>(state.proposal_verifications?.[asset.destination_id]??[]).flatMap(record=>record.sources??[]));
  const sources = [...new Set([...evidence.map(item => item.source_url), ...previous.flatMap(record => record.sources?.map(source => source.url) ?? []), ...savedPages.map(page => page.url), ...relatedSources.map(source=>source.url), ...(campaignId === recoveryCampaignId ? recoverySources[first.story_record_id] ?? [] : [])].filter(Boolean))];
  const pages = (await Promise.all(sources.map(async url => {
   if (!pageCache.has(url)) pageCache.set(url, Promise.resolve().then(() => readSource(url)).catch(() => null));
   const page = await pageCache.get(url);
   if (page) return page;
   const passages = savedPages.filter(source => source.url === url && source.page_sha256);
   return passages.length ? {url, passages_only:true, text:passages.map(source => source.quote).join('\n\n'), page_sha256:passages[0].page_sha256} : null;
  }))).filter(Boolean);
  const destinations = entries.map(({asset}) => destinationFor(state, asset.destination_id))
   .map(({id,name,category,website,relationship,publication_type}) => ({id,name,category,website,relationship,publication_type}));
  const context = {destinations, pages, savedPassages:savedPages, previous:previous.map(({claims, contradictions}) => ({claims, contradictions}))};
  let candidate = first, check = null, reason = 'PRIMARY_SOURCE_PASSAGE_UNAVAILABLE';
  if (pages.length) {
   try {
    if (saved) candidate = reviseText(first, saved.revised_proposal) ?? first;
    else if (checkOnly || first.editorial_source_grounded || priorOutcomes.some(outcome => isEditorialReady(outcome.status))) candidate = first;
    else {
     const draft = await assess({...context, proposal:proposalText(first), stage:'CORRECT'});
     if (draft?.revision) candidate = reviseText(first, draft.revision) ?? first;
     else check = draft;
    }
    if (!check) check = await assess({...context, proposal:proposalText(candidate), stage:'CHECK'});
    if (!checkOnly && (saved || first.editorial_source_grounded) && !entries.some(({asset}) => usableCheck(check, pages, asset.destination_id))) {
     const narrowed = await assess({...context, previous:[...context.previous,{claims:check?.claims,contradictions:check?.contradictions}], proposal:proposalText(candidate), stage:'CORRECT'});
     const revised = reviseText(candidate, narrowed?.revision);
     if (revised && sha256(proposalText(revised)) !== sha256(proposalText(candidate))) {
      candidate = revised;
      check = await assess({...context, proposal:proposalText(candidate), stage:'CHECK'});
     }
    }
    reason = typeof check?.explanation === 'string' ? check.explanation.slice(0,500) : 'EDITORIAL_CHECK_UNRESOLVED';
    if (first.kind === 'X' && usableCheck(check, pages, first.destination_id) &&
        sha256(proposalText(candidate)) !== sha256(proposalText(first))) {
     candidate = await renderRevision(candidate, state);
    }
   } catch {
    check = null;
    reason = 'EDITORIAL_PREPARATION_UNAVAILABLE';
   }
  }
  const corrected = sha256(proposalText(first)) !== sha256(proposalText(candidate));
  const results = entries.map(entry => {
   const id = entry.asset.destination_id;
   const ready = usableCheck(check, pages, id);
   const revised = corrected && (first.kind !== 'X' || ready) ? (first.kind === 'X' ? candidate : reviseText(entry.asset, candidate)) : entry.asset;
   // Shared wording can be saved for all members when independently supported,
   // even when one outlet fails publication fit. Its approval stays disabled.
   const apply = corrected && entries.some(({asset}) => usableCheck(check, pages, asset.destination_id));
   const asset = apply ? revised : entry.asset;
   const status = ready ? (assetFingerprint(asset) === entry.fingerprint ? 'READY_VERIFIED' : 'CORRECTED_READY') : 'INVESTIGATION_REQUIRED';
   const claims = Array.isArray(check?.claims) ? check.claims.filter(Boolean) : [];
   const passages = claims.flatMap(claim => Array.isArray(claim.passages) ? claim.passages.filter(Boolean) : []);
   return {id, fingerprint:entry.fingerprint, inputBinding:bindingFor(state, entry.asset), asset, record:{
    id:randomUUID(), ...bindingFor(state, asset), status, reason,
    claims, sources:passages.flatMap(({url,quote}) => {
     const page = pages.find(item => item.url === url && normalize(quote).length >= 24 && normalize(item.text).includes(normalize(quote)));
     return page ? [{url,quote,page_sha256:page.page_sha256}] : [];
    }),
    reused_revision_id:saved?.id ?? null, checked_at:new Date().toISOString()
   }};
  }).filter(result => pending.some(({asset}) => asset.destination_id === result.id) || result.fingerprint !== assetFingerprint(result.asset));
  try{await store.applyEditorialPreparation(campaignId, results);}
  catch(error){if(error.message!=='STALE_ASSET_REVISION')throw error;}
 }
 const current = (await store.adapter.read(campaignId)).value;
 return Object.fromEntries(Object.keys(current.assets).sort().map(id => [id, editorialStatus(current, id)]));
}

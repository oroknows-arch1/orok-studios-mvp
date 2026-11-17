import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

export const EVIDENCE_GATE_VERSION = 'claim-evidence-v1';
const hash = value => createHash('sha256').update(value).digest('hex');
export const ROUTING_TOPICS=Object.freeze(['Energy','Mining','Transport','Manufacturing','Finance','Technology','Agriculture','Infrastructure','Health','Environment','Trade','Public policy','Markets']);
const blockedPage = /subscribe to (continue|read)|sign in to (continue|read)|enable javascript to continue|verify (that )?you are human|access denied|you have reached your (article|reading) limit/i;
const normalize = value => value.replace(/\s+/gu, ' ').trim();
const decode = text => text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp|ndash|mdash|rsquo|lsquo|rdquo|ldquo);/gi, (whole, entity) => {
 const named = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“'};
 if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? whole;
 const number = /^#x/i.test(entity) ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
 return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
});

export function publicEvidenceUrl(value) {
 try {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      isIP(url.hostname.replace(/[\[\]]/g,'')) || !url.hostname.includes('.') ||
      /\.(?:local|internal|localhost|test|invalid)\.?$/i.test(url.hostname) ||
      url.pathname === '/' || url.hostname.endsWith('.') || /(^|\.)(emradar\.net|emerging-markets-radar\.onrender\.com)$/.test(url.hostname)) return null;
  url.hash = '';
  return url;
 } catch { return null; }
}

function articleParagraphs(html) {
 if (typeof html !== 'string' || !html || html.length > 1_000_000 || /["']isAccessibleForFree["']\s*:\s*(?:false|["']false["'])/i.test(html)) return [];
 const visible = html.replace(/<!--[^]*?-->|<(script|style|noscript|nav|aside|footer|template)\b[^>]*>[^]*?<\/\1\s*>/gi,' ');
 if (blockedPage.test(visible)) return [];
 const articles = [...visible.matchAll(/<article\b[^>]*>([^]*?)<\/article\s*>/gi)];
 const main = [...visible.matchAll(/<main\b[^>]*>([^]*?)<\/main\s*>/gi)];
 const region = articles.length === 1 ? articles[0][1] : articles.length === 0 && main.length === 1 ? main[0][1] : '';
 const paragraphs = [...region.matchAll(/<p\b([^>]*)>([^]*?)<\/p\s*>/gi)]
  .filter(match => !/\bhidden\b|display\s*:\s*none|aria-hidden\s*=\s*["']?true/i.test(match[1]))
  .map(match => normalize(decode(match[2].replace(/<[^>]+>/g,' '))))
  .filter(paragraph => paragraph.length >= 80 && paragraph.length <= 1200 && /[.!?…]["”’)]?$/u.test(paragraph));
 const unique = [...new Set(paragraphs)].slice(0,16);
 // A teaser, metadata citation or search snippet cannot qualify as an article.
 return unique.length >= 3 && unique.join(' ').length >= 500 ? unique : [];
}

function sentences(paragraph) {
 return [...new Intl.Segmenter(undefined,{granularity:'sentence'}).segment(paragraph)].map(item=>item.segment.trim());
}

export function scanClaimLeads(document) {
 if (!Array.isArray(document.records)) return document;
 const evidence=document.records.flatMap(record=>typeof record?.id==='string'&&Array.isArray(record.evidence)?record.evidence.map((source,index)=>({id:record.id+':'+index,record_id:record.id,fact:source?.fact,source_url:source?.url??source?.source_url,verified:false})):[]);
 return {...document,evidence};
}

function candidates(document) {
 const records = new Map((document.records ?? []).filter(record => typeof record?.id === 'string').map(record => [record.id,record]));
 const byFormation = new Map();
 for (const item of document.evidence ?? []) {
  if (typeof item?.id !== 'string' || typeof item.fact !== 'string' || !item.fact.trim()) continue;
  const id = item.record_id ?? (records.size ? null : item.id);
  if (!id || (records.size && !records.has(id))) continue;
  if (!byFormation.has(id)) byFormation.set(id,[]);
  byFormation.get(id).push(item);
 }
 return [...byFormation].map(([id,items]) => ({id,items,record:records.get(id)}));
}

const domain = url => url.hostname.replace(/^www\./,'').split('.').slice(-(/\.(co|com|org|gov|net)\.[a-z]{2}$/.test(url.hostname)?3:2)).join('.');
const digest = (scanSha, evidence, records) => hash(JSON.stringify([EVIDENCE_GATE_VERSION,scanSha,evidence.map(item => [
 item.id,item.fact,item.source_url,item.source,item.record_id,item.page_sha256,item.formation_status,item.role
]),records.map(record=>[record.id,record.status,record.theme,record.causal_chain?.industries])]));

export function createClaimEvidenceGate({readPage,searchAlternatives,assess,maxInvestigations=8,maxPages=5}={}) {
 if ([readPage,searchAlternatives,assess].some(provider => typeof provider !== 'function') ||
     !Number.isInteger(maxInvestigations) || maxInvestigations < 0 || maxInvestigations > 8 ||
     !Number.isInteger(maxPages) || maxPages < 2 || maxPages > 6) throw Error('CLAIM_EVIDENCE_PROVIDERS_REQUIRED');
 return async ({scan,document}) => {
  const evidence = [], records = [], outcomes = [];
  let investigations = 0;
  for (const candidate of candidates(document)) {
   if (investigations >= maxInvestigations) {
    outcomes.push({record_id:candidate.id,status:'BUDGET_HELD'});
    continue;
   }
   investigations++;
   const urls = candidate.items.map(item => item.source_url).filter(Boolean).slice(0,12);
   const hints = candidate.items.slice(0,8).map(item => item.fact.slice(0,600));
   const pages = [], seen = new Set();
   let attempts = 0;
   const read = async (raw, limit) => {
    for (const value of raw) {
     const url = publicEvidenceUrl(value);
     if (!url || seen.has(url.href) || attempts >= limit) continue;
     seen.add(url.href);
     attempts++;
     try {
      const html = await readPage(url);
      const paragraphs = articleParagraphs(html);
      if (paragraphs.length) pages.push({url:url.href,source:domain(url),page_sha256:hash(html),paragraphs});
     } catch { /* Retrieval failure leaves the lead unverified. */ }
    }
   };
   await read(urls,maxPages-2);
   // Search results only supply leads. Each alternative goes through the same retrieval and article-body checks.
   try {
    const alternatives = await searchAlternatives({hints,originalUrls:urls});
    if (Array.isArray(alternatives)) await read(alternatives.slice(0,12),maxPages);
   } catch { /* Available attributable sources can still support a narrower angle. */ }
   if (new Set(pages.map(page => page.source)).size < 2) {
    outcomes.push({record_id:candidate.id,status:'INSUFFICIENT_ACCESSIBLE_SOURCES'});
    continue;
   }
   let result;
   try { result = await assess({hints,pages:pages.map(({url,source,paragraphs})=>({url,source,paragraphs:paragraphs.map(sentences)}))}); }
   catch { outcomes.push({record_id:candidate.id,status:'ASSESSMENT_UNAVAILABLE'}); continue; }
   const selected = Array.isArray(result?.premises) ? result.premises.map(ref => {
    const page = Number.isInteger(ref?.page) ? pages[ref.page] : null;
    const paragraph = Number.isInteger(ref?.paragraph) ? page?.paragraphs[ref.paragraph] : null;
    const fact = paragraph && Number.isInteger(ref?.sentence) ? sentences(paragraph)[ref.sentence] : null;
    if (!fact || fact.length < 45 || fact.length > 180 || !['CHANGE','CONSEQUENCE'].includes(ref.role)) return null;
    return {page,fact,role:ref.role};
   }) : [];
   // Two independent, complementary source passages are the minimum for an article offer.
   if (result?.significant !== true || result?.contradiction !== false || result?.independent !== true ||
       selected.length !== 2 || selected.some(item => !item) ||
       new Set(selected.map(item => item.page.source)).size !== 2 ||
       new Set(selected.map(item => item.role)).size !== 2 ||
       selected[0].fact.toLowerCase() === selected[1].fact.toLowerCase()) {
    outcomes.push({record_id:candidate.id,status:'NO_SUPPORTED_SIGNIFICANT_ANGLE'});
    continue;
   }
   selected.sort((a,b)=>a.role.localeCompare(b.role));
   for (const {page,fact,role} of selected) {
    evidence.push({id:'claim-'+hash(JSON.stringify([candidate.id,page.url,page.page_sha256,fact])).slice(0,24),
     verified:true,fact,source:page.source,source_url:page.url,page_sha256:page.page_sha256,record_id:candidate.id,
     formation_status:'INVESTIGATE',role});
   }
   outcomes.push({record_id:candidate.id,status:'VERIFIED_PREMISES_FORMATION_UNRESOLVED'});
   // The scanner's analytical headings and conclusions are deliberately excluded from worker input.
   const topics=Array.isArray(result.topics)?ROUTING_TOPICS.filter(topic=>result.topics.includes(topic)):[];
   records.push({id:candidate.id,status:'INVESTIGATE',theme:'Evidence from '+selected[0].page.source+' and '+selected[1].page.source,
    causal_chain:{industries:topics.length?topics.slice(0,3):['Markets']}});
  }
  return {snapshot_date:scan.snapshot_date, records, evidence, evidence_gate:{
   version:EVIDENCE_GATE_VERSION,scan_sha256:scan.artifact_sha256,digest:digest(scan.artifact_sha256,evidence,records),investigations,outcomes
  }};
 };
}

export function assertGatedDocument(document, scan) {
 const gate = document?.evidence_gate;
 const evidence = document?.evidence;
 const records=document?.records;
 if (gate?.version !== EVIDENCE_GATE_VERSION || gate.scan_sha256 !== scan?.artifact_sha256 ||
     !/^[a-f0-9]{64}$/.test(gate.scan_sha256) || !Array.isArray(evidence) || !Array.isArray(records) ||
     records.some(record=>record?.status!=='INVESTIGATE'||typeof record.theme!=='string'||
      !Array.isArray(record.causal_chain?.industries)||!record.causal_chain.industries.every(topic=>ROUTING_TOPICS.includes(topic))) ||
     evidence.some(item => item?.verified !== true || !item.id || !item.record_id ||
      !publicEvidenceUrl(item.source_url) || !/^[a-f0-9]{64}$/.test(item.page_sha256 ?? '') ||
      typeof item.fact !== 'string' || !item.fact || domain(new URL(item.source_url)) !== item.source ||
      item.formation_status !== 'INVESTIGATE') ||
     gate.digest !== digest(scan.artifact_sha256,evidence,records)) throw Error('VERIFIED_CLAIM_EVIDENCE_REQUIRED');
 return document;
}

export function selectVerifiedPremises(document, scan, destinations) {
 assertGatedDocument(document,scan);
 const allowed = document.evidence.filter(item => destinations.every(destination => destination?.evidence?.ids?.includes(item.id)));
 for (const change of allowed.filter(item => item.role === 'CHANGE')) {
  const consequence = allowed.find(item => item.role === 'CONSEQUENCE' && item.record_id === change.record_id && item.source !== change.source);
  if (consequence) return [change,consequence];
 }
 throw Error('VERIFIED_SIGNIFICANT_STORY_REQUIRED');
}

export function verifiedProposalText(kind, evidence) {
 const [change,consequence] = evidence;
 const subject = 'Article idea from EMRADAR | '+change.source+' and '+consequence.source;
 const excerpts = evidence.map(item => `“${item.fact}”\n${item.source_url}`).join('\n\n');
 const caveat = 'The wider market formation remains under investigation.';
 if (kind === 'X') return {subject:'EMRADAR · Sources under review',body:excerpts+'\n\n'+caveat};
 if (kind !== 'EMAIL') throw Error('VERIFIED_PROPOSAL_KIND_REQUIRED');
 return {subject,body:[
  'Hello,',
  'I’m Sean Walker, working on EMRADAR.',
  'Two independently sourced details from our latest review stood out.',
  excerpts,
  'I’m developing an article on how these two developments relate and what evidence would show a wider market shift. '+caveat,
  'Would an article on this interest you?',
  'I can send a sourced draft for review.',
  'Regards,',
  'Sean Walker\nEMRADAR'
 ].join('\n\n')};
}

export function assertVerifiedProposal({document,scan,destination,asset,normalizeText=text=>text}) {
 if (!asset || asset.destination_id !== destination?.id || asset.kind !== (destination.id === 'x' ? 'X' : 'EMAIL'))
  throw Error('VERIFIED_PROPOSAL_DESTINATION_REQUIRED');
 if(!Array.isArray(asset.evidence_ids)||asset.evidence_ids.length!==2)throw Error('VERIFIED_PROPOSAL_CONTENT_REQUIRED');
 const selected=selectVerifiedPremises(document,scan,[destination,{evidence:{ids:asset.evidence_ids}}]);
 const expected = verifiedProposalText(asset.kind,selected);
 if (asset.claim_evidence_digest !== document.evidence_gate.digest ||
     asset.evidence_ids?.join() !== selected.map(item=>item.id).join() ||
     asset.subject !== expected.subject || asset.body !== normalizeText(expected.body))
  throw Error('VERIFIED_PROPOSAL_CONTENT_REQUIRED');
 return selected;
}

export function expandEvidenceLinks(evidence,ids) {
 const linked=new Set(ids);
 const formations=new Set(evidence.filter(item=>linked.has(item.id)).map(item=>item.record_id).filter(Boolean));
 return evidence.filter(item=>linked.has(item.id)||formations.has(item.record_id)).map(item=>item.id);
}

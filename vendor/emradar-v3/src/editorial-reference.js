import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const EDITORIAL_REFERENCE=Object.freeze({version:1,id:'semiconductor-for-you-outreach-v1',thread_id:'1a0f640622c1fefe',message_id:'1a0f640622c1fefe',sha256:'2b9b48434d441749f39e8489123ccfa628687f324ae034c1e9c67be0f3beb541'});
export const originalOutreach=readFileSync(new URL('../verification/semiconductor-for-you-outreach-v1.txt',import.meta.url),'utf8');
if(createHash('sha256').update(originalOutreach).digest('hex')!==EDITORIAL_REFERENCE.sha256)throw Error('EDITORIAL_REFERENCE_INTEGRITY_FAILED');

export const isEditorialDestination=destination=>['EDITORIAL_PUBLICATION','INFORMATION_CHANNEL'].includes(destination?.destination_class)||/\b(?:news|journal|publication|media|magazine|review|editorial|research)\b/i.test(String(destination?.category??''));
const recordId=item=>item.record_id??item.id.split(':')[0];

// A shared industry label is not evidence that separate events form a story.
// Use one scanner-supported formation; retain its source facts and caveats.
export function selectEditorialEvidence(document,allowed){
 const verified=(document?.evidence??[]).filter(item=>item.verified===true&&item.id);
 const linked=verified.filter(item=>allowed.includes(item.id));
 if(!linked.length)throw Error('V3_DESTINATION_EVIDENCE_REQUIRED');
 const groups=new Map();
 for(const item of linked){const id=recordId(item);if(!groups.has(id))groups.set(id,{id,linked:0});groups.get(id).linked++;}
 const selected=[...groups.values()].sort((a,b)=>b.linked-a.linked)[0];
 const record=(document?.records??[]).find(item=>item?.id===selected.id)??null;
 return {record_id:selected.id,evidence:verified.filter(item=>recordId(item)===selected.id),analysis_context:record?{
  theme:record.theme??null,
  why_surfaced:record.why_surfaced??null,
  causal_chain:record.causal_chain??null,
  contradictions:record.contradictions??[],
  missing_evidence:record.missing_evidence??[]
 }:null};
}

export function validateEditorialStory(draft,story){
 const allowed=new Set(story.evidence.map(item=>item.id));
 if(!Array.isArray(draft.story_evidence_ids)||!draft.story_evidence_ids.length||draft.story_evidence_ids.some(id=>!allowed.has(id)))throw Error('V3_UNSUPPORTED_EDITORIAL_CONNECTION');
 if(typeof draft.limitations!=='string'||!draft.limitations.trim()||typeof draft.body!=='string'||!draft.body.includes(draft.limitations.trim()))throw Error('V3_EDITORIAL_UNCERTAINTY_REQUIRED');
 if(typeof draft.analytical_finding!=='string'||draft.analytical_finding.trim().length<24||!draft.body.includes(draft.analytical_finding.trim()))throw Error('V3_ANALYTICAL_FINDING_REQUIRED');
 if(!/\b(?:because|means|indicat|reveals?|shows?|shift|depends?|bottleneck|constraint|rather than|not .{0,40} but)\b/i.test(draft.analytical_finding))throw Error('V3_ANALYTICAL_FINDING_REQUIRED');
}

export const editorialPrompt=`Use the ORIGINAL successful outreach below as the mandatory writing reference, not a description of it. Keep its human voice and progression: introduce Sean Walker and EMRADAR; explain what we discovered and what stood out; show a supported connection; propose a specific article or research contribution; keep material uncertainty visible; ask if the editor is interested and offer a sourced draft. Adapt the actual story and publication; do not substitute its name into a fixed template. Explain the possibility in everyday language. Do not describe yourself as merely using EMRADAR. Do not copy the semiconductor facts, scan dates or internal classifications into other stories. Financial figures are optional, never a substitute for explaining the discovery.

ORIGINAL OUTREACH (verbatim):
${originalOutreach}
END ORIGINAL OUTREACH.

Return JSON strings subject, body, analytical_finding, limitations, plus story_evidence_ids (array of source evidence IDs used). Body is the middle of a complete email, without greeting or signature. Use only the supplied single-formation story, verified facts and analysis_context. The analytical_finding must be a distinctive plain-language sentence quoted verbatim in body: explain the supported mechanism, constraint or change rather than restating figures. If the evidence supports no such finding, do not manufacture one. Explain why it interests the specific destination using its supplied relationship, without inventing an audience or expertise. For a podcast or other channel offer a research contribution appropriate to it. Do not claim separate projects supply one another, are financed, operational or commercially successful unless a supplied source says so. Do not connect this story to another formation merely because both share an industry. Keep proposals distinct from completed work and include the material caveat naturally in the body, not a long uncertainty list. The limitations field must quote the exact material-caveat sentence or phrase already present in body. No unsupported causal claims, generic promotion, jargon-heavy recaps, rigid length formula, greetings, signatures or URLs. Follow editorial_angle only where the evidence supports it.`;

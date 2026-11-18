import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import claimPolicy from '../vendor/emradar-v3-authoritative/src/claim-evidence.cjs';
import {normalizePublishedEvidence} from '../vendor/emradar-v3/src/scan-evidence-adapter.js';

const scans=['2026-10-18','2026-11-18'];
const fixture=date=>normalizePublishedEvidence(JSON.parse(readFileSync(new URL(`../../emerging-markets-radar/data/checkpoints/discovery-${date}.json`,import.meta.url))));
const compact=value=>String(value??'').replace(/\s+/g,' ').trim();

test('historical scan records retain causal structure using simulated downloaded passages and zero search',async()=>{
 for(const date of scans){
  const input=fixture(date),byUrl=new Map();
  for(const item of input.evidence){
   const list=byUrl.get(item.source_url)??[];list.push(item);byUrl.set(item.source_url,list);
  }
  let searches=0,checks=0;
  const gate=claimPolicy.createClaimEvidenceGate({maxInvestigations:30,
   readPage:async url=>{const facts=(byUrl.get(url)??[]).map(item=>item.fact);if(!facts.length)return null;const text=(facts.join(' ')+' Independent historical fixture context confirms the attributable passage without adding a claim. ').repeat(3);return {title:'Historical attributable source',text,sha256:createHash('sha256').update(text).digest('hex')};},
   findSources:async()=>{searches++;return [];},
   assess:async({claims,pages})=>{const claim=claims.find(item=>pages.some(page=>page.url===item.url));if(!claim)return {supported:[],story:{significant:false}};const proposition=`What would change if the observed constraint around ${compact(claim.fact).slice(0,90)} persists?`;return {supported:[{id:claim.id,status:'SUPPORTED',url:claim.url,excerpt:claim.fact}],story:{significant:true,claim_ids:[claim.id],headline:`Formation test: ${compact(claim.fact).slice(0,90)}`,finding:`The attributable evidence establishes a bounded change whose wider market mechanism still requires investigation.`,industries:['historical scan'],relationships:[{cause:'The attributable source records the observed change',effect:'The formation now requires connected market investigation',mechanism:'The verified observation creates a bounded pressure or constraint to trace',evidence_ids:[claim.id]}],scenarios:[{status:'UNRESOLVED_QUESTION',proposition,evidence_ids:[claim.id],missing_evidence:['Cross-sector consequence evidence']}]}};},
   checkAngle:async angle=>{checks++;return angle.relationships.length===1&&angle.scenarios.length===1;}
  });
  const result=await gate({scan:{snapshot_date:date,artifact_sha256:createHash('sha256').update(JSON.stringify(input)).digest('hex')},document:input});
  assert.equal(searches,0,`${date} must not spend search budget`);
  assert.ok(result.records.length>=Math.min(6,input.records.length),`${date} should retain broad record coverage`);
  assert.equal(result.records.length,checks);
  assert.ok(result.records.every(record=>record.causal_chain.relationships.length&&record.scenarios.length));
  assert.ok(result.records.every(record=>record.status==='INVESTIGATE'));
 }
});

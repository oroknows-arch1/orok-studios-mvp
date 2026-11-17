import {assertProductionProposal} from './verified-proposal-policy.js';

const unsent = new Set(['NOT_ATTEMPTED','FAILED_DEFINITELY_UNSENT']);
export function quarantineUnsupported(state,protectedIds,{fingerprint,createGroups}) {
 if (!['ASSETS_PREPARED','PUBLICATION_REVIEW'].includes(state?.phase)) return state;
 const affected = new Set();
 for (const [id,entry] of Object.entries(state.assets ?? {})) {
  const decision=state.decisions?.[id];
  if (protectedIds.has(id) || !unsent.has(state.deliveries?.[id]?.status ?? 'NOT_ATTEMPTED') ||
      ['REJECT','EXCLUDE'].includes(decision?.decision) || entry.asset?.claim_evidence_quarantine) continue;
  if (!['EMAIL','X'].includes(entry.asset?.kind)) continue;
  try { assertProductionProposal(state,entry.asset); continue; } catch { /* Legacy evidence cannot authorize release. */ }
  state.editorial_versions??={};
  state.editorial_versions[id]??=[];
  state.editorial_versions[id].push({...structuredClone(entry),label:'Evidence quarantine',previous_decision:structuredClone(decision??null)});
  const asset={campaign_id:state.id,destination_id:id,kind:entry.asset.kind,from:entry.asset.from,
   subject:'Evidence review required',body:'This draft is held because its claims lack a verified evidence record. The original is available in draft history.',
   evidence_ids:[],review_status:'NEEDS_REVISION',delivery_eligible:false,claim_evidence_quarantine:true,
   preparation_error:'VERIFIED_CLAIM_EVIDENCE_REQUIRED'};
  state.assets[id]={asset,fingerprint:fingerprint(asset)};
  delete state.decisions?.[id];
  if (state.review_actions?.[id]) state.review_actions[id]={...state.review_actions[id],status:'CANCELLED',reason:'EVIDENCE_QUARANTINE'};
  affected.add(id);
 }
 if (!affected.size) return state;
 state.events??=[];
 state.evidence_quarantine??={};
 for (const id of affected) state.evidence_quarantine[id]={reason:'VERIFIED_CLAIM_EVIDENCE_REQUIRED'};
 for (const [groupId,group] of Object.entries(state.email_groups??{})) {
  if (!group.destination_ids.some(id=>affected.has(id))) continue;
  const prior=state.group_approvals?.[groupId];
  if (prior) state.events.push({type:'EVIDENCE_QUARANTINE_GROUP_APPROVAL_INVALIDATED',group_id:groupId,previous_approval:structuredClone(prior)});
  delete state.group_approvals?.[groupId];
  const remaining=group.destination_ids.filter(id=>!affected.has(id));
  for(const id of remaining){
   if(protectedIds.has(id)||!unsent.has(state.deliveries?.[id]?.status??'NOT_ATTEMPTED')||state.decisions?.[id]?.group_id!==groupId)continue;
   state.events.push({type:'EVIDENCE_QUARANTINE_GROUP_MEMBER_APPROVAL_INVALIDATED',destination_id:id,previous_approval:structuredClone(state.decisions[id])});
   delete state.decisions[id];
  }
  if (!remaining.length) delete state.email_groups[groupId];
  else state.email_groups[groupId]={...group,destination_ids:remaining,version:group.version+1};
 }
 if (!state.email_groups) state.email_groups=createGroups();
 state.events.push({type:'PROPOSALS_QUARANTINED',destination_ids:[...affected]});
 return state;
}

export async function quarantineLegacyProposals({pool,store}) {
 const {rows}=await pool.query(`SELECT c.campaign_id,
  ARRAY(SELECT DISTINCT r.destination_id FROM v3_send_reservations r WHERE r.campaign_id=c.campaign_id
   AND r.status NOT IN ('NOT_ATTEMPTED','FAILED_DEFINITELY_UNSENT')) AS protected_ids
  FROM v3_campaign_state c
  WHERE c.payload->>'phase' IN ('ASSETS_PREPARED','PUBLICATION_REVIEW')
   AND c.payload->'preparation_input'->'document'->'evidence_gate' IS NULL
   AND EXISTS (SELECT 1 FROM jsonb_each(COALESCE(c.payload->'assets','{}')) a(id,entry)
    WHERE a.entry->'asset'->>'kind' IN ('EMAIL','X')
    AND a.entry->'asset'->'claim_evidence_quarantine' IS NULL
    AND COALESCE(c.payload->'decisions'->a.id->>'decision','') NOT IN ('REJECT','EXCLUDE')
    AND COALESCE(c.payload->'deliveries'->a.id->>'status','NOT_ATTEMPTED') IN ('NOT_ATTEMPTED','FAILED_DEFINITELY_UNSENT')
    AND NOT EXISTS (SELECT 1 FROM v3_send_reservations r WHERE r.campaign_id=c.campaign_id AND r.destination_id=a.id
     AND r.status NOT IN ('NOT_ATTEMPTED','FAILED_DEFINITELY_UNSENT')))`);
 for (const row of rows) await store.quarantineEvidence(row.campaign_id,new Set(row.protected_ids),quarantineUnsupported);
 return rows.length;
}

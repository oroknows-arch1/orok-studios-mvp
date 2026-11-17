import {assetFingerprint} from './contracts.js';
import claimPolicy from '../../emradar-v3-authoritative/src/claim-evidence.cjs';

const {hasAssetClaimEvidence}=claimPolicy;
const unsent=delivery=>!delivery||['NOT_ATTEMPTED','FAILED_DEFINITELY_UNSENT'].includes(delivery.status);
const holdReason='V3_LEGACY_OR_UNSUPPORTED_CLAIM_EVIDENCE';

export function quarantineUnverifiedAssets(state,{rejectedDestinationIds=new Set()}={}){
 const quarantined=[];
 for(const [id,entry] of Object.entries(state.assets??{})){
  const decision=state.decisions?.[id];
  if(!unsent(state.deliveries?.[id])||entry.asset.preparation_error===holdReason||
     (!rejectedDestinationIds.has(id)&&hasAssetClaimEvidence(state,entry.asset))||
     (entry.asset.review_status==='NEEDS_REVISION'&&decision?.decision!=='APPROVE'))continue;
  state.editorial_versions??={};
  state.editorial_versions[id]??=[];
  state.editorial_versions[id].push({...structuredClone(entry),previous_decision:structuredClone(decision??null),hold_reason:holdReason});
  if(decision?.decision==='APPROVE')delete state.decisions[id];
  const asset={campaign_id:entry.asset.campaign_id,destination_id:id,kind:entry.asset.kind,
   from:entry.asset.from,subject:'Held for claim evidence review',
   body:'This draft has been held. Its material claims need to be verified against accessible source text before a replacement can be approved.',
   evidence_ids:[],review_status:'NEEDS_REVISION',preparation_error:holdReason,delivery_eligible:false};
  state.assets[id]={asset,fingerprint:assetFingerprint(asset)};
  quarantined.push({destination_id:id,previous_fingerprint:entry.fingerprint,approval_invalidated:decision?.decision==='APPROVE'});
 }
 if(!quarantined.length)return quarantined;
 const held=new Set(quarantined.map(entry=>entry.destination_id));
 for(const [id,group] of Object.entries(state.email_groups??{})){
  if(!group.destination_ids.some(member=>held.has(member)))continue;
  const approval=state.group_approvals?.[id];
  state.events.push({type:'EMAIL_GROUP_EVIDENCE_HOLD',group:structuredClone(group),previous_approval:structuredClone(approval??null)});
  if(state.group_approvals)delete state.group_approvals[id];
  group.destination_ids=group.destination_ids.filter(member=>!held.has(member));
  group.version++;
  for(const member of group.destination_ids){
   if(unsent(state.deliveries?.[member])&&state.decisions?.[member]?.group_id===id&&state.decisions[member].decision==='APPROVE'){
    state.events.push({type:'STALE_GROUP_MEMBER_APPROVAL',decision:structuredClone(state.decisions[member])});
    delete state.decisions[member];
   }
  }
  if(!group.destination_ids.length)delete state.email_groups[id];
 }
 state.events.push({type:'CLAIM_EVIDENCE_QUARANTINE',proposals:quarantined});
 if(!Object.values(state.assets).some(({asset})=>hasAssetClaimEvidence(state,asset))){
  state.review_completion={...state.review_completion,complete:false,review_ready:false,delivery_ready:false};
 }
 return quarantined;
}

export async function quarantineSavedProposals({pool,store}){
 const {rows}=await pool.query(`SELECT campaign_id FROM v3_campaign_state
   WHERE payload->>'phase' IN ('PUBLICATION_REVIEW','ASSETS_PREPARED')
   AND EXISTS (
    SELECT 1 FROM jsonb_each(COALESCE(payload->'assets','{}')) AS a
    WHERE COALESCE(payload->'deliveries'->a.key->>'status','NOT_ATTEMPTED') IN ('NOT_ATTEMPTED','FAILED_DEFINITELY_UNSENT')
    AND (COALESCE(a.value->'asset'->>'review_status','READY') <> 'NEEDS_REVISION' OR payload->'decisions'->a.key->>'decision'='APPROVE')
   )`);
 const report=[];
 for(const {campaign_id:campaignId} of rows){
  const snapshot=(await store.adapter.read(campaignId))?.value;
  if(!snapshot||!quarantineUnverifiedAssets(structuredClone(snapshot)).length)continue;
  const updated=await store.mutate(campaignId,current=>{quarantineUnverifiedAssets(current);return current;});
  const event=updated.events.findLast(item=>item.type==='CLAIM_EVIDENCE_QUARANTINE');
  if(event)report.push({campaignId,proposals:event.proposals});
 }
 return report;
}

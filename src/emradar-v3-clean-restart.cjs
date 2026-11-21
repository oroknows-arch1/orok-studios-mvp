'use strict';
const {createHash}=require('node:crypto');

const restartDate='2026-11-18';
const restartKey='claim-evidence-restart-2026-11-18';
const sourceReaderRevision='article-body-blocks-v2';
function recoverableSourceRecords(state){
 if(state?.phase!=='SCAN_VERIFIED'||state.claim_gate_attempt?.status!=='NO_VERIFIED_ANGLE')return null;
 const revision=state.claim_gate_attempt?.policy_revision;
 const exactCampaign=state.id==='v3-24f5f995f02b72406c040e3f4ca5189f'&&
  state.scan?.artifact_sha256==='709ce5ead1e5b34a190db9a31835ab58d9c0a2fa1a5bcd90c19489171759cff5';
 const creditRecovery=revision==='provider-diagnostics-v2'&&exactCampaign;
 const figureRecovery=revision==='credit-restored-v3'&&exactCampaign;
 if(revision==='exact-figure-v4'||(state.claim_gate_previous&&revision!=='investigative-question-v1'&&!creditRecovery&&!figureRecovery))return null;
 const document=state.preparation_input?.document;
 if(document?.evidence?.length!==0)return null;
 if(creditRecovery)return (document.claim_audit??[]).filter(item=>item.status==='EVIDENCE_CHECK_FAILED'&&
  item.provider_code==='credit_balance_exhausted').map(item=>item.record_id);
 if(figureRecovery)return (document.claim_audit??[]).filter(item=>item.record_id==='colombia-accesos-norte-ii-construction-2026'&&
  item.status==='NO_SUPPORTED_SIGNIFICANT_ANGLE').map(item=>item.record_id);
 const statuses=revision==='investigative-question-v1'?['EVIDENCE_CHECK_FAILED']:
  ['SOURCE_INACCESSIBLE','NO_SUPPORTED_SIGNIFICANT_ANGLE','EVIDENCE_CHECK_FAILED'];
 return (document.claim_audit??[]).filter(item=>statuses.includes(item.status)).map(item=>item.record_id);
}
function campaignIdentity(sourceKey,key){
 return 'v3-'+createHash('sha256').update(key?sourceKey+':'+key:sourceKey).digest('hex').slice(0,32);
}

async function retireDisposableCampaigns(pool,keepId){
 const {rows}=await pool.query(`
  UPDATE v3_campaign_state
  SET version=version+1,updated_at=now(),
      payload=payload || jsonb_build_object(
       'phase','CLOSED','decisions','{}'::jsonb,'group_approvals','{}'::jsonb,
       'retirement',jsonb_build_object('reason',$3::text,'phase',payload->>'phase',
        'decisions',coalesce(payload->'decisions','{}'),'group_approvals',coalesce(payload->'group_approvals','{}')))
  WHERE campaign_id ~ '^v3-[a-f0-9]{32}$' AND campaign_id<>$1
    AND payload->'scan'->>'snapshot_date'<=$2
    AND payload->>'phase' IN ('SCAN_VERIFIED','DESTINATIONS_SELECTED','ASSETS_PREPARED','PUBLICATION_REVIEW','OWNER_DECIDED')
    AND NOT EXISTS (
     SELECT 1 FROM jsonb_each(coalesce(payload->'deliveries','{}')) AS delivery
     WHERE coalesce(delivery.value->>'status','') NOT IN ('NOT_ATTEMPTED','FAILED_DEFINITELY_UNSENT')
    )
    AND NOT EXISTS (SELECT 1 FROM v3_send_reservations WHERE v3_send_reservations.campaign_id=v3_campaign_state.campaign_id)
  RETURNING campaign_id`,[keepId,restartDate,restartKey]);
 return rows.map(row=>row.campaign_id);
}
async function retireUnsentApprovals(pool,keepId){
 const {rows}=await pool.query(`
  WITH stale AS (
   SELECT c.campaign_id,c.version,jsonb_object_agg(d.key,d.value) AS decisions,
     array_agg(d.key) AS ids,
     array_remove(array_agg(d.value->>'group_id'),NULL) AS groups
   FROM v3_campaign_state c CROSS JOIN LATERAL jsonb_each(coalesce(c.payload->'decisions','{}')) d
   WHERE c.campaign_id ~ '^v3-[a-f0-9]{32}$' AND c.campaign_id<>$1
    AND c.payload->'scan'->>'snapshot_date'<=$2 AND c.payload->>'phase'='PUBLICATION_REVIEW'
    AND d.value->>'decision'='APPROVE'
    AND coalesce(c.payload->'deliveries'->d.key->>'status','NOT_ATTEMPTED') IN ('NOT_ATTEMPTED','FAILED_DEFINITELY_UNSENT')
    AND NOT EXISTS (SELECT 1 FROM v3_send_reservations r WHERE r.campaign_id=c.campaign_id AND r.destination_id=d.key)
   GROUP BY c.campaign_id,c.version
  )
  UPDATE v3_campaign_state c SET version=c.version+1,updated_at=now(),
   payload=c.payload || jsonb_build_object(
    'decisions',(c.payload->'decisions')-stale.ids,
    'group_approvals',coalesce(c.payload->'group_approvals','{}')-stale.groups,
    'retired_unsent_approvals',coalesce(c.payload->'retired_unsent_approvals','{}')||stale.decisions,
    'retired_unsent_group_approvals',coalesce(c.payload->'retired_unsent_group_approvals','{}')||
       coalesce((SELECT jsonb_object_agg(g.key,g.value)
        FROM jsonb_each(coalesce(c.payload->'group_approvals','{}')) g WHERE g.key=ANY(stale.groups)),'{}'))
  FROM stale WHERE c.campaign_id=stale.campaign_id AND c.version=stale.version
  RETURNING cardinality(stale.ids) AS count`,[keepId,restartDate]);
 return rows.reduce((sum,row)=>sum+row.count,0);
}

function recoverableRecords(state,key){
 if(key!==restartKey||state?.phase!=='SCAN_VERIFIED'||state.claim_gate_attempt?.status!=='NO_VERIFIED_ANGLE'||state.claim_gate_previous)return null;
 const document=state.preparation_input?.document;
 if(document?.evidence?.length!==0)return null;
 const eligible=(document.claim_audit??[]).filter(item=>item.status==='EVIDENCE_CHECK_FAILED'&&item.claims.some(claim=>claim.status==='SUPPORTED'));
 return eligible.sort((a,b)=>b.claims.filter(c=>c.status==='SUPPORTED').length-a.claims.filter(c=>c.status==='SUPPORTED').length).map(item=>item.record_id);
}
const recoverableRecord=(state,key)=>recoverableRecords(state,key)?.[0]??null;
module.exports={sourceReaderRevision,recoverableSourceRecords,restartDate,restartKey,campaignIdentity,retireDisposableCampaigns,retireUnsentApprovals,recoverableRecords,recoverableRecord};

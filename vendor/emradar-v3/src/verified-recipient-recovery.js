import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {CampaignStore} from './state.js';
import {PostgresAdapter} from './adapters/postgres.js';

// Historical evidence is isolated from the active directory, campaign assets and learning inputs.
export function pruneUnverifiedState(state){
 const removed=state.destinations.filter(d=>d.id!=='x'&&!recipientPolicy.verifiedDestination(d));
 const ids=new Set([...removed.map(d=>d.id),...Object.entries(state.assets??{}).filter(([id,entry])=>entry.asset?.kind==='EMAIL'&&!state.destinations.some(d=>d.id===id&&recipientPolicy.verifiedDestination(d))).map(([id])=>id)]);
 const snapshot={destinations:removed,assets:{},editorial_versions:{}};
 for(const id of ids){
  if(state.assets?.[id]){snapshot.assets[id]=state.assets[id];delete state.assets[id];}
  if(state.editorial_versions?.[id]){snapshot.editorial_versions[id]=state.editorial_versions[id];delete state.editorial_versions[id];}
 }
 state.destinations=state.destinations.filter(d=>!ids.has(d.id));
 // Rejected alternatives are audit material, never active discovery or learning inputs.
 if(state.editorial_rewrite){snapshot.editorial_rewrite=state.editorial_rewrite;delete state.editorial_rewrite;}
 return {state,snapshot,removed:ids.size};
}
export async function cleanUnverifiedRecipients({pool,campaignId}){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS v3_recipient_audit (
   audit_key TEXT PRIMARY KEY, snapshot JSONB NOT NULL, archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query('LOCK TABLE v3_outlet_directory IN SHARE ROW EXCLUSIVE MODE');
  const {rows:outlets}=await client.query('SELECT outlet_id,record FROM v3_outlet_directory');
  let directory_removed=0,campaign_destinations_removed=0;const hints=[],assets={};
  for(const {outlet_id,record} of outlets){
   if(recipientPolicy.verifiedDestination(record))continue;
   // Publication legitimacy and contact readiness are independent. Keep proven
   // publications in the active directory so later bounded research can upgrade
   // them without repeating discovery or losing opt-outs/history.
   if(recipientPolicy.verifiedPublication(record)){hints.push(record);continue;}
   if(record.verification?.scan_evidence_digest)hints.push(record);
   await client.query('INSERT INTO v3_recipient_audit(audit_key,snapshot) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',['directory:'+outlet_id,JSON.stringify(record)]);
   await client.query('DELETE FROM v3_outlet_directory WHERE outlet_id=$1',[outlet_id]);directory_removed++;
  }
  const {rows:campaigns}=await client.query("SELECT campaign_id FROM v3_campaign_state WHERE payload ? 'destinations' ORDER BY campaign_id");
  const store=new CampaignStore(new PostgresAdapter(client));
  for(const {campaign_id} of campaigns){
   const current=(await store.adapter.read(campaign_id)).value;
   const pruned=pruneUnverifiedState(structuredClone(current));
   if(!pruned.removed&&!pruned.snapshot.editorial_rewrite)continue;
   // Full pre-cleanup snapshot preserves exact decisions, revisions, receipts and relationships.
   await client.query('INSERT INTO v3_recipient_audit(audit_key,snapshot) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',['campaign:'+campaign_id,JSON.stringify(current)]);
   await store.mutate(campaign_id,state=>{
    const next=pruneUnverifiedState(state);return next.state;
   });
   campaign_destinations_removed+=pruned.removed;
   if(campaign_id===campaignId)Object.assign(assets,pruned.snapshot.assets);
  }
  await client.query('COMMIT');
  const target=(await new PostgresAdapter(pool).read(campaignId))?.value;
  const evidenceIds=new Set(target?.preparation_input?.document?.evidence?.map(e=>e.id));
  return {directory_removed,campaign_destinations_removed,assets,hints:hints.filter(item=>item.verification.evidence_ids?.some(id=>evidenceIds.has(id)))};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

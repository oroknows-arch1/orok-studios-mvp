// Require a reviewed, source-backed match between a published scan fact and
// an outlet before any imported contact becomes eligible for preparation.
export function createReviewedEvidenceLinker({reviewedLinks}) {
 if(!Array.isArray(reviewedLinks)) throw Error('REVIEWED_LINKS_REQUIRED');
 return async ({document,outlets})=>{
  const evidence=new Map((document?.evidence??[]).filter(e=>e?.verified===true && e?.id && e?.source_url && e?.fact).map(e=>[e.id,e]));
  const outletsById=new Map((outlets??[]).map(o=>[o.id,o]));
  const links=new Map();
  for(const item of reviewedLinks){
   if(item?.approved!==true || typeof item.outlet_id!=='string' || !outletsById.has(item.outlet_id)) continue;
   const source=evidence.get(item.evidence_id);
   if(!source || item.record_id!==source.record_id || item.source_url!==source.source_url) continue;
   if(!links.has(item.outlet_id)) links.set(item.outlet_id,new Set());
   links.get(item.outlet_id).add(source.id);
  }
  return [...links].map(([outlet_id,ids])=>({outlet_id,evidence_ids:[...ids]}));
 };
}

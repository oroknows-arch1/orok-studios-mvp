// Adapt the scanner's published record-level evidence without altering the source document.
// The source publication attestation is checked by scan intake before this runs.
export function normalizePublishedEvidence(document) {
 if (!document || !Array.isArray(document.records)) return document;
 const evidence=[];
 const ids=new Set();
 for(const record of document.records) {
  if(typeof record?.id!=='string' || !Array.isArray(record.evidence)) continue;
  for(let index=0;index<record.evidence.length;index++){
   const source=record.evidence[index];
   if(typeof source?.fact!=='string' || !source.fact.trim() || typeof source?.date!=='string') continue;
   let url;
   try {url=new URL(source.url); } catch {continue;}
   if(url.protocol!=='https:' || url.username || url.password) continue;
   const id=record.id+':'+index;
   if(ids.has(id)) throw Error('DUPLICATE_SOURCE_EVIDENCE_ID');
   ids.add(id);
   evidence.push({id,verified:true,source_url:url.toString(),fact:source.fact,source:source.source,date:source.date,record_id:record.id});
  }
 }
 return {...document,evidence};
}

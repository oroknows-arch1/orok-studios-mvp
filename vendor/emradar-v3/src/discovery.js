import {selectDestinations} from './destination-selection.js';

// Candidate records are supplied by an external, evidence-backed directory.
// This adapter does not invent outlets or contact details.
export function createDiscovery({loadCandidates,limit=30}) {
 if(typeof loadCandidates!=='function') throw Error('DISCOVERY_SOURCE_REQUIRED');
 return async ({scan,document,history=[]})=>{
  const candidates=await loadCandidates({scan,document});
  const result=selectDestinations({
   candidates,
   scanEvidence:document?.evidence??[],
   history,
   limit
  });
  const evidenceIds=(document?.evidence??[]).filter(e=>e?.verified===true && e.id).map(e=>e.id);
  if(!evidenceIds.length) throw Error('NO_VERIFIED_EVIDENCE');
  return [
   {id:'x',category:'social',evidence:{ids:evidenceIds},contact_verified:true},
   ...result.selected.filter(d=>d.id!=='x')
  ];
 };
}

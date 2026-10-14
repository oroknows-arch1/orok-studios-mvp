import {createDiscovery} from './discovery.js';

// Read the fresh persistent outlet directory; attach only evidence links
// explicitly supplied for the current scan by the caller.
export function createDirectoryDiscovery({directory,linkEvidence,limit=29}) {
 if(typeof directory?.list!=='function' || typeof linkEvidence!=='function') throw Error('DIRECTORY_DISCOVERY_DEPENDENCIES_REQUIRED');
 return createDiscovery({
  limit,
  loadCandidates:async ({scan,document})=>{
   const existing=await directory.list();
   const links=await linkEvidence({scan,document,outlets:existing});
   const outlets=await directory.list();
   if(!Array.isArray(links)) throw Error('DIRECTORY_EVIDENCE_LINKS_REQUIRED');
   const byId=new Map();
   for(const link of links){
    if(!link?.outlet_id)continue;
    const ids=Array.isArray(link.evidence_ids)?link.evidence_ids:link.evidence_id?[link.evidence_id]:[];
    if(!byId.has(link.outlet_id))byId.set(link.outlet_id,new Set());
    for(const id of ids)byId.get(link.outlet_id).add(id);
   }
   return outlets.map(outlet=>({
    ...outlet,
    evidence_ids:[...(byId.get(outlet.id)??[])]
   }));
  }
 });
}

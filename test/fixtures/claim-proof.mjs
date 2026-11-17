import {createHash} from 'node:crypto';
import {createClaimEvidenceGate} from '../../vendor/emradar-v3/src/claim-evidence-gate.js';

export const change='The port authority signed the new terminal construction contract in October and published the construction notice.';
export const consequence='The freight regulator recorded that the existing berths reached their licensed capacity during three months of the year.';
export const article=claim=>`<article><p>${claim} The following timeline lists the publication dates of the statements in this report.</p>
 <p>The underlying reports are maintained as separate public records with publication dates, archived versions and contact information for their respective authors and editors.</p>
 <p>The published material includes methodology and reporting references, with the relevant documents accessible directly from the publisher for independent inspection.</p>
 <p>There is a separate archive of related reporting for readers who need historical context and information about subsequent public proceedings and decisions.</p></article>`;
export const pages={
 'https://port.example/releases/terminal':article(change),
 'https://regulator.example/report/freight':article(consequence)
};
export const selection={significant:true,contradiction:false,independent:true,topics:['Transport'],premises:[
 {page:0,paragraph:0,sentence:0,role:'CHANGE'},
 {page:1,paragraph:0,sentence:0,role:'CONSEQUENCE'}
]};
export const leads={snapshot_date:'2026-11-17',publication_state:'PUBLISHED',records:[{
 id:'port-expansion',theme:'Unsupported claim of commissioning',status:'CONFIRMED',
 causal_chain:{consequences:['Unsupported capacity increase of 900%']},
 evidence:[{fact:'The terminal opened and capacity increased by 900%.',url:'https://blocked.example/premium/story'}]
}]};
export const scanHash=createHash('sha256').update(JSON.stringify(leads)).digest('hex');
export const scan={snapshot_date:leads.snapshot_date,source_key:leads.snapshot_date+':'+scanHash,artifact_sha256:scanHash,live_artifact_sha256:scanHash,archive_artifact_sha256:scanHash,publication_verified:true};
export const fixtureGate=overrides=>createClaimEvidenceGate({
 readPage:async url=>{if(!(url.href in pages))throw Error('HTTP_403');return pages[url.href];},
 searchAlternatives:async ()=>Object.keys(pages),
 assess:async ()=>selection,...overrides
});

export async function verifiedReleaseFixture(campaignId='campaign') {
 const {scanClaimLeads}=await import('../../vendor/emradar-v3/src/claim-evidence-gate.js');
 const {writeVerifiedProposal}=await import('../../vendor/emradar-v3/src/verified-proposal-policy.js');
 const {default:recipient}=await import('./v3-verified-recipient.cjs');
 const document=await fixtureGate()({scan,document:scanClaimLeads(leads)});
 const prepare=destination=>({destination,asset:{...writeVerifiedProposal({campaignId,destination,document,scan}),review_status:'READY'}});
 return {state:{scan,preparation_input:{document}},email:id=>prepare(recipient(id,document.evidence)),
  x:prepare({id:'x',evidence:{ids:document.evidence.map(item=>item.id)},contact_verified:true})};
}

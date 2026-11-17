import brand from '../../../src/email-brand.cjs';
import {EDITORIAL_REFERENCE,EDITORIAL_ENFORCEMENT_VERSION} from './editorial-reference.js';
import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {assertVerifiedProposal,selectVerifiedPremises,verifiedProposalText} from './claim-evidence-gate.js';

export function writeVerifiedProposal({campaignId,destination,document,scan,sharedDestinations}) {
 if (destination.id !== 'x') recipientPolicy.assertVerifiedDestination(destination);
 for (const member of sharedDestinations ?? []) recipientPolicy.assertVerifiedDestination(member);
 const premises = selectVerifiedPremises(document,scan,[destination,...(sharedDestinations ?? [])]);
 const kind = destination.id === 'x' ? 'X' : 'EMAIL';
 const asset = {
  campaign_id:campaignId,destination_id:destination.id,kind,
  ...verifiedProposalText(kind,premises),from:brand.identity.address,
  evidence_ids:premises.map(item=>item.id),story_record_id:premises[0].record_id,
  claim_evidence_digest:document.evidence_gate.digest
 };
 if (kind === 'X') return asset;
 return brand.brand({...asset,correspondence_type:'EDITORIAL_OUTREACH',to:destination.contact.email,
  contact_status:'VERIFIED',delivery_eligible:true,recipient_verification:destination.contact,
  editorial_reference:EDITORIAL_REFERENCE,editorial_enforcement:EDITORIAL_ENFORCEMENT_VERSION});
}

export function assertProductionProposal(state,asset) {
 const document=state?.preparation_input?.document;
 const beforeBrand = text => brand.brand({body:text}).body;
 const premises=assertVerifiedProposal({document,scan:state?.scan,asset,
  destination:state?.destinations?.find(item=>item.id===asset?.destination_id),
  normalizeText:asset?.kind==='EMAIL' ? beforeBrand : undefined});
 if (asset.review_status==='NEEDS_REVISION')throw Error('VERIFIED_PROPOSAL_CONTENT_REQUIRED');
 if (asset.story_record_id !== premises[0].record_id) throw Error('VERIFIED_STORY_ID_REQUIRED');
 if (asset.kind === 'EMAIL') brand.envelope(asset);
 return premises;
}

import {isReviewPhase} from './contracts.js';
import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import emailBrand from '../../../src/email-brand.cjs';
import { randomUUID } from 'node:crypto';
import { assertScan, assertDestinations, assetFingerprint, assertApproval, assertSendable, sha256 } from './contracts.js';

export class CampaignStore {
  constructor(adapter) {
    if (!adapter || typeof adapter.read !== 'function' || typeof adapter.compareAndSwap !== 'function') throw Error('DURABLE_ADAPTER_REQUIRED');
    this.adapter = adapter;
  }
  async mutate(id, fn) {
    for (let i = 0; i < 8; i++) {
      const prior = await this.adapter.read(id);
      const next = fn(structuredClone(prior?.value ?? null));
      if (next === undefined) throw Error('INVALID_MUTATION');
      const written = await this.adapter.compareAndSwap(id, prior?.version ?? null, next);
      if (written) return next;
    }
    throw Error('CONCURRENT_UPDATE_RETRY_EXHAUSTED');
  }
  async start(scan) {
    const verified = assertScan(scan);
    const id = 'v3-' + sha256(verified.source_key).slice(0,32);
    await this.mutate(id, previous => {
      if (previous) {
        if (previous.scan.source_key !== verified.source_key) throw Error('SCAN_IDENTITY_CONFLICT');
        return previous;
      }
      return {id, scan:verified, phase:'SCAN_VERIFIED', destinations:[], assets:{}, decisions:{}, deliveries:{}, events:[{type:'SCAN_VERIFIED',id:randomUUID()}]};
    });
    return id;
  }
  async select(id, destinations) {
    assertDestinations(destinations);
    return this.mutate(id, state => {
      if (!state || !['SCAN_VERIFIED','DESTINATIONS_SELECTED'].includes(state.phase)) throw Error('INVALID_PHASE');
      if (state.phase === 'DESTINATIONS_SELECTED' && sha256(state.destinations) !== sha256(destinations)) throw Error('DESTINATIONS_ALREADY_LOCKED');
      state.destinations = structuredClone(destinations);
      state.phase = 'DESTINATIONS_SELECTED';
      return state;
    });
  }
  async prepare(id, assets) {
    return this.mutate(id, state => {
      if (!state || !['DESTINATIONS_SELECTED','PUBLICATION_REVIEW'].includes(state.phase)) throw Error('INVALID_PHASE');
      const valid = new Set(state.destinations.map(d => d.id));
      const next = {};
      for (const asset of assets) {
        if (!valid.has(asset.destination_id) || asset.campaign_id !== id || next[asset.destination_id]) throw Error('INVALID_ASSET_DESTINATION');
        if(asset.kind==='EMAIL')recipientPolicy.assertVerifiedAsset(asset,state.destinations.find(d=>d.id===asset.destination_id));
        next[asset.destination_id] = {asset:structuredClone(asset), fingerprint:assetFingerprint(asset)};
      }
      if (Object.keys(next).length !== state.destinations.length) throw Error('MISSING_DESTINATION_ASSET');
      if (state.phase === 'PUBLICATION_REVIEW' && sha256(next) !== sha256(state.assets)) throw Error('REVIEW_ASSETS_LOCKED');
      state.assets = next;
      state.phase = 'PUBLICATION_REVIEW';
      return state;
    });
  }
  async extendReview(id,destinations,assets) {
    assertDestinations(destinations);
    return this.mutate(id,state=>{
      if(!state || !isReviewPhase(state.phase)) throw Error('REVIEW_NOT_OPEN');
      const existing=new Set(state.destinations.map(destination=>destination.id));
      const additions=new Map(destinations.filter(destination=>!existing.has(destination.id)).map(destination=>[destination.id,destination]));
      if(assets.length!==additions.size) throw Error('MISSING_DESTINATION_ASSET');
      for(const asset of assets){
        if(!additions.has(asset.destination_id)||asset.campaign_id!==id||state.assets[asset.destination_id]) throw Error('INVALID_ASSET_DESTINATION');
        if(asset.kind==='EMAIL')recipientPolicy.assertVerifiedAsset(asset,additions.get(asset.destination_id));
        state.assets[asset.destination_id]={asset:structuredClone(asset),fingerprint:assetFingerprint(asset)};
      }
      state.destinations.push(...[...additions.values()].map(destination=>structuredClone(destination)));
      state.events.push({type:'EDITORIAL_DRAFTS_ADDED',count:additions.size,id:randomUUID()});
      return state;
    });
  }
  async decide(id, destinationId, decision, fingerprint) {
    return this.mutate(id, state => {
      if (!state || !isReviewPhase(state.phase)) throw Error('REVIEW_NOT_OPEN');
      const item = state.assets[destinationId];
      if (!item || item.fingerprint !== fingerprint || !['APPROVE','REJECT'].includes(decision)) throw Error('INVALID_DECISION');
      // Editorial decisions are independent of delivery readiness. Recipient
      // verification remains mandatory in claimDelivery and transport checks.
      if (state.deliveries[destinationId]) throw Error('DECISION_AFTER_DISTRIBUTION');
      state.decisions[destinationId] = {authority:'OWNER',decision,asset_sha256:fingerprint,campaign_id:id,destination_id:destinationId};
      return state;
    });
  }
  async revise(id,destinationId,fingerprint,changes) {
    if (!changes || typeof changes!=='object' || Array.isArray(changes)) throw Error('INVALID_REVISION');
    const allowed=['subject','body'];
    if (!Object.keys(changes).length || Object.keys(changes).some(key=>!allowed.includes(key))) throw Error('INVALID_REVISION_FIELDS');
    for (const value of Object.values(changes)) {
      if (typeof value!=='string' || !value.trim() || value.length>50000) throw Error('INVALID_REVISION_TEXT');
    }
    return this.mutate(id,state=>{
      if (!state || !isReviewPhase(state.phase)) throw Error('REVIEW_NOT_OPEN');
      const entry=state.assets[destinationId];
      if (!entry || entry.fingerprint!==fingerprint) throw Error('STALE_ASSET_REVISION');
      if (state.deliveries[destinationId]) throw Error('REVISION_AFTER_DISTRIBUTION');
      const revised={...entry.asset,...changes};
      if(revised.brand_version)revised.html=emailBrand.render(revised.body);
      if (sha256(revised)===sha256(entry.asset)) return state;
      const nextFingerprint=assetFingerprint(revised);
      const priorDecision=state.decisions[destinationId]?.decision??null;
      state.assets[destinationId]={asset:revised,fingerprint:nextFingerprint};
      delete state.decisions[destinationId];
      state.events.push({type:'ASSET_REVISED',destination_id:destinationId,id:randomUUID(),previous_fingerprint:fingerprint,new_fingerprint:nextFingerprint,previous_decision:priorDecision,changed_fields:Object.keys(changes)});
      return state;
    });
  }
  async claimDelivery(id,destinationId) {
    return this.mutate(id, state => {
      if (!state || state.phase !== 'PUBLICATION_REVIEW') throw Error('REVIEW_NOT_OPEN');
      const item = state.assets[destinationId];
      if (!item) throw Error('UNKNOWN_DESTINATION');
      const prior = state.deliveries[destinationId];
      if(item.asset.kind==='EMAIL')recipientPolicy.assertVerifiedAsset(item.asset,state.destinations.find(d=>d.id===destinationId));
      const key = assertSendable({asset:item.asset,approval:state.decisions[destinationId],receipt:prior});
      state.deliveries[destinationId] = {status:'ATTEMPTING',idempotency_key:key,claimed_at:new Date().toISOString()};
      return state;
    });
  }
  async recordDelivery(id,destinationId,status,receipt) {
    if (!['ACCEPTED','AMBIGUOUS','FAILED_DEFINITELY_UNSENT','CONFIRMED'].includes(status)) throw Error('INVALID_DELIVERY_RESULT');
    return this.mutate(id,state => {
      const prior=state?.deliveries[destinationId];
      if (!prior || !['ATTEMPTING','ACCEPTED','AMBIGUOUS'].includes(prior.status)) throw Error('DELIVERY_NOT_CLAIMED');
      if (prior.status==='ACCEPTED' && status!=='CONFIRMED') throw Error('ACCEPTED_STATUS_CANNOT_REGRESS');
      if (prior.status==='AMBIGUOUS' && status==='CONFIRMED' && !receipt?.provider_id) throw Error('CONFIRMATION_RECEIPT_REQUIRED');
      if (status==='ACCEPTED' && !receipt?.provider_id) throw Error('ACCEPTANCE_RECEIPT_REQUIRED');
      if (status==='FAILED_DEFINITELY_UNSENT' && !receipt?.independent_proof) throw Error('NONDELIVERY_PROOF_REQUIRED');
      if (status==='CONFIRMED' && !receipt?.provider_id) throw Error('CONFIRMATION_RECEIPT_REQUIRED');
      if (prior.status==='AMBIGUOUS' && status==='ACCEPTED' && !receipt?.provider_id) throw Error('ACCEPTANCE_RECEIPT_REQUIRED');
      if (prior.status==='ACCEPTED' && status==='FAILED_DEFINITELY_UNSENT') throw Error('ACCEPTED_CANNOT_BE_UNSENT');
      state.deliveries[destinationId]={...prior,status,receipt:structuredClone(receipt??null)};
      return state;
    });
  }
}

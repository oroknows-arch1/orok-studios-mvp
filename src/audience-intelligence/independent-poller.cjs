'use strict';
// Independently scheduled polling cycle: injected read-only snapshot reader,
// attestation provider and audience-only job sink. Never called from V3.
const { mapV3Snapshot } = require('./v3-real-receipt-mapper.cjs');
async function pollOnce({ readSnapshots, attestResearch, saveAudienceJob, maxSnapshots = 20, readTimeoutMs = 5000 }) {
  if (typeof readSnapshots !== 'function' || typeof attestResearch !== 'function' ||
      typeof saveAudienceJob !== 'function') throw new TypeError('independent adapters required');
  const stats = { scanned:0, eligible:0, saved:0, ignored:0, errors:0 };
  let snapshots;
  try {
    const timeout = Math.max(1,Math.min(30000,readTimeoutMs));
    snapshots = await Promise.race([
      Promise.resolve().then(()=>readSnapshots(Math.max(0,Math.min(100,maxSnapshots)))),
      new Promise((_,reject)=>{ timer=setTimeout(()=>reject(Error('AUDIENCE_READ_TIMEOUT')),timeout); })
    ]);
  } catch {
    return { status:'AUDIENCE_SOURCE_UNAVAILABLE', ...stats };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!Array.isArray(snapshots)) return { status:'AUDIENCE_SOURCE_INVALID', ...stats };
  const seen = new Set();
  for (const snapshot of snapshots.slice(0,Math.max(0,Math.min(100,maxSnapshots)))) {
    stats.scanned++;
    try {
      const proof = await attestResearch(snapshot);
      const result = mapV3Snapshot(snapshot,proof);
      if (result.status !== 'ELIGIBLE_DOWNSTREAM') { stats.ignored++; continue; }
      if (seen.has(result.job.idempotencyKey)) continue;
      seen.add(result.job.idempotencyKey);
      stats.eligible++;
      // Sink must enforce unique idempotencyKey in audience-owned storage.
      await saveAudienceJob(result.job);
      stats.saved++;
    } catch { stats.errors++; }
  }
  return { status:'AUDIENCE_POLL_COMPLETED', ...stats };
}
module.exports = { pollOnce };

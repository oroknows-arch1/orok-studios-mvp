'use strict';
const { Pool } = require('pg');
const SQL = `INSERT INTO audience_jobs
 (x_post_id,receipt_id,formation_id,scan_sha256,scan_url)
 VALUES ($1,$2,$3,$4,$5)
 ON CONFLICT (x_post_id) DO NOTHING RETURNING x_post_id`;
function createAudienceJobSink(pool) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('audience-owned pool required');
  return async function saveAudienceJob(job) {
    if (!job || !/^[0-9]{1,30}$/.test(job.xPostId || '') ||
        !/^[a-f0-9]{64}$/.test(job.digest || '') ||
        !job.receiptId || !job.formationId ||
        typeof job.scanUrl !== 'string' || !job.scanUrl.startsWith('https://'))
      throw new TypeError('invalid audience job');
    const result = await pool.query(SQL,[job.xPostId,job.receiptId,job.formationId,job.digest,job.scanUrl]);
    return { inserted:result.rowCount === 1 };
  };
}
function openAudiencePool(connectionString) {
  if (!connectionString) throw new Error('AUDIENCE_DATABASE_URL required');
  return new Pool({connectionString, max:2, connectionTimeoutMillis:3000, idleTimeoutMillis:3000,
    options:'-c statement_timeout=5000 -c lock_timeout=1000'});
}
module.exports={createAudienceJobSink,openAudiencePool};

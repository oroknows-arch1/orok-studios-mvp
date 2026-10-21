'use strict';
// CI-only schema setup, completed before parallel integration tests start.
async function main(){
 if(!process.env.V3_TEST_DATABASE_URL)throw Error('V3_TEST_DATABASE_URL_REQUIRED');
 const {Pool}=require('pg');
 const {V3Reservations}=require('../src/emradar-v3-reservations.cjs');
 const pool=new Pool({connectionString:process.env.V3_TEST_DATABASE_URL});
 try{
  await pool.query('CREATE TABLE IF NOT EXISTS v3_campaign_state (campaign_id TEXT PRIMARY KEY,version BIGINT NOT NULL,payload JSONB NOT NULL)');
  await new V3Reservations(pool).initialize();
  const {OutletDirectory}=await import('../vendor/emradar-v3/src/outlet-directory.js');
  await new OutletDirectory(pool).initialize();
 }finally{await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

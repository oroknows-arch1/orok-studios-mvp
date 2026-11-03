'use strict';
// Local disposable PostgreSQL only. No production role or grant changes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const databaseUrl=process.env.V3_TEST_DATABASE_URL;
test('audience role can read V3 and write only its own schema', {skip:!databaseUrl},async()=>{
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:databaseUrl,max:2});
 const id=randomBytes(8).toString('hex'),role='aud_reader_'+id,upstream='v3_test_'+id,audience='aud_test_'+id;
 const client=await pool.connect();
 try{
  await client.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
  await client.query(`CREATE SCHEMA ${upstream}`);
  await client.query(`CREATE SCHEMA ${audience} AUTHORIZATION ${role}`);
  await client.query(`CREATE TABLE ${upstream}.v3_campaign_state(campaign_id text primary key,payload jsonb not null)`);
  await client.query(`INSERT INTO ${upstream}.v3_campaign_state VALUES ('campaign','{"phase":"PUBLICATION_REVIEW"}')`);
  await client.query(`GRANT USAGE ON SCHEMA ${upstream} TO ${role}`);
  await client.query(`GRANT SELECT ON ${upstream}.v3_campaign_state TO ${role}`);
  await client.query(`SET ROLE ${role}`);
  assert.equal((await client.query(`SELECT payload->>'phase' AS phase FROM ${upstream}.v3_campaign_state`)).rows[0].phase,'PUBLICATION_REVIEW');
  await client.query(`CREATE TABLE ${audience}.emradar_audience_state (key text primary key,payload jsonb)`);
  await client.query(`INSERT INTO ${audience}.emradar_audience_state VALUES ('draft','{}')`);
  await client.query(`UPDATE ${audience}.emradar_audience_state SET payload='{"review":"pending"}' WHERE key='draft'`);
  assert.equal((await client.query(`SELECT payload->>'review' AS review FROM ${audience}.emradar_audience_state`)).rows[0].review,'pending');
  for(const sql of [
   `INSERT INTO ${upstream}.v3_campaign_state VALUES ('bad','{}')`,
   `UPDATE ${upstream}.v3_campaign_state SET payload='{}'`,
   `DELETE FROM ${upstream}.v3_campaign_state`,
   `TRUNCATE ${upstream}.v3_campaign_state`,
   `CREATE TABLE ${upstream}.bad(id int)`
  ])await assert.rejects(()=>client.query(sql),error=>error.code==='42501');
  await client.query('RESET ROLE');
  assert.equal((await client.query(`SELECT payload->>'phase' AS phase FROM ${upstream}.v3_campaign_state WHERE campaign_id='campaign'`)).rows[0].phase,'PUBLICATION_REVIEW');
 }finally{
  await client.query('RESET ROLE').catch(()=>{});
  await client.query(`DROP SCHEMA IF EXISTS ${audience} CASCADE`).catch(()=>{});
  await client.query(`DROP SCHEMA IF EXISTS ${upstream} CASCADE`).catch(()=>{});
  await client.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  client.release();await pool.end();
 }
});

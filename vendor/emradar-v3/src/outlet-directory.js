import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
// Fresh V3 outlet directory; uses the caller's existing PostgreSQL connection.
// Does not import or modify the old marketing directory.
export class OutletDirectory {
 constructor(pool) {
  if(!pool?.query) throw Error('DIRECTORY_DATABASE_REQUIRED');
  this.pool=pool;
 }
 async initialize() {
  await this.pool.query(`CREATE TABLE IF NOT EXISTS v3_outlet_directory (
   outlet_id TEXT PRIMARY KEY,
   record JSONB NOT NULL,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await this.pool.query("CREATE UNIQUE INDEX IF NOT EXISTS v3_outlet_recipient_unique ON v3_outlet_directory(lower(record->'contact'->>'email')) WHERE record->'contact'->>'email' IS NOT NULL");
  await this.pool.query(`CREATE TABLE IF NOT EXISTS v3_contact_research (
   research_key TEXT PRIMARY KEY, scan_digest TEXT NOT NULL, record JSONB NOT NULL,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
 }
 async recordResearch(record){
  if(!record?.publication||!record.scan_digest||!record.status)throw Error('RESEARCH_RECORD_REQUIRED');
  const key=record.scan_digest+':'+(record.website?new URL(record.website).hostname.replace(/^www\./,''):record.publication.toLowerCase());
  await this.pool.query(`INSERT INTO v3_contact_research(research_key,scan_digest,record) VALUES($1,$2,$3::jsonb)
   ON CONFLICT(research_key) DO UPDATE SET record=EXCLUDED.record || jsonb_build_object('history',
   COALESCE(v3_contact_research.record->'history','[]'::jsonb) || jsonb_build_array(v3_contact_research.record-'history')),updated_at=now()`,[key,record.scan_digest,JSON.stringify(record)]);
 }
 async researchHistory(scanDigest){
  const {rows}=await this.pool.query('SELECT record FROM v3_contact_research WHERE scan_digest=$1 ORDER BY research_key',[scanDigest]);
  return rows.map(row=>row.record);
 }
 async upsert(record) {
  if(!record || typeof record.id!=='string' || !record.id.trim()) throw Error('OUTLET_ID_REQUIRED');
  recipientPolicy.assertVerifiedDestination(record);
  const existing=await this.pool.query("SELECT record FROM v3_outlet_directory WHERE lower(record->'contact'->>'email')=lower($1) AND outlet_id<>$2",[record.contact.email,record.id]);
  if(existing.rows.length)throw Error('V3_DUPLICATE_RECIPIENT');
  await this.pool.query(
   'INSERT INTO v3_outlet_directory(outlet_id,record) VALUES($1,$2::jsonb) ON CONFLICT(outlet_id) DO UPDATE SET record=EXCLUDED.record,updated_at=now()',
   [record.id,JSON.stringify(record)]
  );
  return record.id;
 }
 async upsertPublication(record) {
  if(!record || typeof record.id!=='string' || !record.id.trim()) throw Error('OUTLET_ID_REQUIRED');
  if(!recipientPolicy.verifiedPublication(record))throw Error('V3_VERIFIED_PUBLICATION_REQUIRED');
  const prior=await this.pool.query('SELECT record FROM v3_outlet_directory WHERE outlet_id=$1',[record.id]);
  const existing=prior.rows[0]?.record;
  if(existing?.opted_out||existing?.do_not_contact||existing?.contact?.opted_out||existing?.contact?.do_not_contact)
   record={...record,opted_out:existing.opted_out,do_not_contact:existing.do_not_contact,contact:existing.contact};
  if(recipientPolicy.verifiedDestination(existing)&&!recipientPolicy.verifiedDestination(record))return record.id;
  await this.pool.query('INSERT INTO v3_outlet_directory(outlet_id,record) VALUES($1,$2::jsonb) ON CONFLICT(outlet_id) DO UPDATE SET record=EXCLUDED.record,updated_at=now()',[record.id,JSON.stringify(record)]);
  return record.id;
 }
 async excludePublication(id,reason){
  const {rows}=await this.pool.query('SELECT record FROM v3_outlet_directory WHERE outlet_id=$1',[id]);
  const previous=rows[0]?.record;if(!previous)return false;
  const exclusion={active:false,publication_verified:false,discovery_status:'EXCLUDED_SOURCE_INSTITUTION',exclusion:{reason,previous_record:previous,excluded_at:new Date().toISOString()}};
  const result=await this.pool.query('UPDATE v3_outlet_directory SET record=record || $2::jsonb,updated_at=now() WHERE outlet_id=$1 AND record=$3::jsonb',[id,JSON.stringify(exclusion),JSON.stringify(previous)]);
  if(result.rowCount!==1)return false;
  await this.recordResearch({publication:previous.name,website:previous.website,scan_digest:previous.verification.scan_evidence_digest,status:'EXCLUDED',reason});
  return true;
 }
 async list() {
  const {rows}=await this.pool.query('SELECT record FROM v3_outlet_directory ORDER BY outlet_id');
  return rows.map(row=>row.record).filter(recipientPolicy.verifiedPublication);
 }
 async listContactVerified(){return (await this.list()).filter(recipientPolicy.verifiedDestination);}
}

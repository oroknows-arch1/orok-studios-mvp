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
 }
 async upsert(record) {
  if(!record || typeof record.id!=='string' || !record.id.trim()) throw Error('OUTLET_ID_REQUIRED');
  await this.pool.query(
   'INSERT INTO v3_outlet_directory(outlet_id,record) VALUES($1,$2::jsonb) ON CONFLICT(outlet_id) DO UPDATE SET record=EXCLUDED.record,updated_at=now()',
   [record.id,JSON.stringify(record)]
  );
  return record.id;
 }
 async list() {
  const {rows}=await this.pool.query('SELECT record FROM v3_outlet_directory ORDER BY outlet_id');
  return rows.map(row=>row.record);
 }
}

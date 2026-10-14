// Uses a caller-supplied pg Pool. No credentials or global connection are embedded.
export class PostgresAdapter {
 constructor(pool) { if (!pool?.query) throw Error('POSTGRES_POOL_REQUIRED'); this.pool=pool; }
 async initialize() {
  await this.pool.query(`CREATE TABLE IF NOT EXISTS v3_campaign_state (
   campaign_id TEXT PRIMARY KEY,
   version BIGINT NOT NULL CHECK (version > 0),
   payload JSONB NOT NULL,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
 }
 async read(key) {
  const {rows}=await this.pool.query('SELECT version,payload FROM v3_campaign_state WHERE campaign_id=$1',[key]);
  return rows.length?{version:Number(rows[0].version),value:rows[0].payload}:null;
 }
 async compareAndSwap(key,version,value) {
  if(version===null) {
   const {rowCount}=await this.pool.query('INSERT INTO v3_campaign_state(campaign_id,version,payload) VALUES($1,1,$2::jsonb) ON CONFLICT DO NOTHING',[key,JSON.stringify(value)]);
   return rowCount===1;
  }
  const {rowCount}=await this.pool.query('UPDATE v3_campaign_state SET version=version+1,payload=$3::jsonb,updated_at=now() WHERE campaign_id=$1 AND version=$2',[key,version,JSON.stringify(value)]);
  return rowCount===1;
 }
}

'use strict';
// Audience-owned CAS adapter. Upstream adapters expose reads only; V3 tables
// and sessions cannot be written through this adapter or this database role.
class AudienceAdapter{
 constructor({pool,readSource,readOwnerAccess}){
  if(!pool?.query||typeof readSource!=='function'||typeof readOwnerAccess!=='function')throw Error('AUDIENCE_ISOLATED_ADAPTER_REQUIRED');
  Object.assign(this,{pool,readSource,readOwnerAccess});
 }
 async initialize(){await this.pool.query('CREATE TABLE IF NOT EXISTS emradar_audience_state (key TEXT PRIMARY KEY, version INTEGER NOT NULL, payload JSONB NOT NULL)');}
 async read(key){
  if(key.startsWith('review:'))return this.readOwnerAccess(key.slice(7));
  const found=(await this.pool.query('SELECT version,payload AS value FROM emradar_audience_state WHERE key=$1',[key])).rows[0];
  return found??null;
 }
 async importSource(id){
  if(await this.read(id))return;
  const source=(await this.readSource(id))?.value;
  if(source?.phase!=='PUBLICATION_REVIEW')throw Error('AUDIENCE_SOURCE_REVIEW_REQUIRED');
  const value={id,phase:source.phase,scan:structuredClone(source.scan),assets:{x:structuredClone(source.assets?.x)},editorial_versions:{x:structuredClone(source.editorial_versions?.x??[])},events:[],decisions:{},deliveries:{}};
  await this.compareAndSwap(id,null,value);
 }
 async compareAndSwap(key,version,value){
  if(key.startsWith('review:'))throw Error('AUDIENCE_UPSTREAM_WRITE_FORBIDDEN');
  if(version===null)return (await this.pool.query('INSERT INTO emradar_audience_state(key,version,payload) VALUES($1,1,$2) ON CONFLICT DO NOTHING',[key,value])).rowCount===1;
  return (await this.pool.query('UPDATE emradar_audience_state SET version=version+1,payload=$3 WHERE key=$1 AND version=$2',[key,version,value])).rowCount===1;
 }
}
module.exports={AudienceAdapter};

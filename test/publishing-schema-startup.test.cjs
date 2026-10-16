const test=require('node:test');const assert=require('node:assert/strict');
const {PostgresPublishingRepository}=require('../src/publishing/db/postgres-repository');
const {loadMigrations}=require('../src/publishing/db/migrate');
test('existing pending schema migrations run before scheduler repository is ready; rerun is inert',async()=>{
 const applied=new Set(loadMigrations().slice(0,3).map(m=>m.name)),queries=[];
 const client={release(){},query:async(sql,args)=>{queries.push(sql);if(sql.startsWith('SELECT name'))return {rows:[...applied].map(name=>({name}))};if(sql.includes('INSERT INTO publishing_migrations'))applied.add(args[0]);return {rows:[]};}};
 const repo=new PostgresPublishingRepository({connect:async()=>client});await repo.init();
 assert.equal(applied.size,5);assert(queries.some(s=>s.includes('ADD COLUMN IF NOT EXISTS macro_signal')));assert(queries.some(s=>s.includes('ADD COLUMN IF NOT EXISTS series_meta')));assert(!queries.some(s=>/DROP|TRUNCATE|DELETE FROM publishing_items/.test(s)));
 const before=queries.filter(s=>s==='BEGIN').length;await repo.init();assert.equal(queries.filter(s=>s==='BEGIN').length,before);
});
test('migration failure rolls back and rejects initialization, preventing scheduler startup',async()=>{
 const queries=[];const client={release(){},query:async sql=>{queries.push(sql);if(sql.startsWith('SELECT name'))return {rows:[]};if(sql.includes('CREATE TABLE IF NOT EXISTS publishing_items'))throw Error('DB_DENIED');return {rows:[]};}};
 await assert.rejects(new PostgresPublishingRepository({connect:async()=>client}).init(),/DB_DENIED/);assert(queries.includes('ROLLBACK'));
});

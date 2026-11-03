'use strict';
// Independent test-file schema: concurrent legacy fixtures must not appear as
// unresolved production attempts in another test's account-wide quota check.
async function isolatedAudiencePool(connectionString,max=12){
 const {Pool}=require('pg'),{randomBytes}=require('node:crypto');
 const schema='audience_test_'+randomBytes(8).toString('hex');
 const admin=new Pool({connectionString,max:1});await admin.query('CREATE SCHEMA '+schema);
 const pool=new Pool({connectionString,max,options:'-c search_path='+schema}),end=pool.end.bind(pool);
 pool.end=async()=>{try{await end();await admin.query('DROP SCHEMA '+schema+' CASCADE');}finally{await admin.end();}};
 return pool;
}
module.exports={isolatedAudiencePool};

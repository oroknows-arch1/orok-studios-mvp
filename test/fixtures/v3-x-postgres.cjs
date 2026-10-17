'use strict';
// Disposable SQL-contract fixture. Never connects to a real database.
const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const envConfig=()=>({X_CLIENT_ID:'test-client',X_CLIENT_SECRET:'test-secret',X_ACCOUNT_ID:'123',EMRADAR_V3_REVIEW_ORIGIN:'https://review.example.org',EMRADAR_V3_X_TOKEN_KEY:Buffer.alloc(32,3).toString('base64')});
function memoryPg(env=envConfig()){
 let authorization=null,held=false;const waiting=[],states=new Map(),queries=[];
 function encrypt(value,purpose='authorization'){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(env.EMRADAR_V3_X_TOKEN_KEY,'base64'),iv);
  cipher.setAAD(Buffer.from('emradar-v3:x:v1:'+env.X_CLIENT_ID+':'+purpose));
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
 }
 function decrypt(value=authorization,purpose='authorization'){
  const cipher=createDecipheriv('aes-256-gcm',Buffer.from(env.EMRADAR_V3_X_TOKEN_KEY,'base64'),Buffer.from(value.iv,'base64'));
  cipher.setAAD(Buffer.from('emradar-v3:x:v1:'+env.X_CLIENT_ID+':'+purpose));cipher.setAuthTag(Buffer.from(value.tag,'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8'));
 }
 async function query(sql,args=[]){
  queries.push({sql,args:structuredClone(args)});
  if(sql.startsWith('CREATE TABLE'))return {rows:[],rowCount:0};
  if(sql.startsWith('SELECT encrypted_record'))return {rows:authorization?[{encrypted_record:structuredClone(authorization)}]:[]};
  if(sql.startsWith('INSERT INTO v3_x_authorization')){authorization=JSON.parse(args[0]);return {rowCount:1,rows:[]};}
  if(sql.startsWith('UPDATE v3_x_oauth_states SET expires_at')){for(const row of states.values())if(!row.consumed_at&&row.expires_at>args[0])row.expires_at=args[0];return {rows:[],rowCount:1};}
  if(sql.startsWith('INSERT INTO v3_x_oauth_states')){states.set(args[0],{campaign_id:args[1],session_id:args[2],encrypted_pending:JSON.parse(args[3]),expires_at:args[4],consumed_at:null});return {rowCount:1,rows:[]};}
  if(sql.startsWith('SELECT campaign_id,session_id')){const row=states.get(args[0]);return {rows:row&&!row.consumed_at&&row.expires_at>args[1]?[{campaign_id:row.campaign_id,session_id:row.session_id}]:[]};}
  if(sql.startsWith('UPDATE v3_x_oauth_states SET consumed_at')){const row=states.get(args[0]);if(!row||row.consumed_at||row.expires_at<=args[1]||row.campaign_id!==args[2]||row.session_id!==args[3])return {rows:[],rowCount:0};row.consumed_at=args[1];return {rows:[{encrypted_pending:structuredClone(row.encrypted_pending)}],rowCount:1};}
  throw Error('UNEXPECTED_TEST_SQL');
 }
 const pool={query,connect:async()=>{
  let locked=false;
  return {query:async(sql,args)=>{
   if(sql.includes('pg_advisory_unlock')){queries.push({sql,args:[]});if(locked){locked=false;const next=waiting.shift();if(next)next();else held=false;}return {rows:[]};}
   if(sql.includes('pg_advisory_lock')){queries.push({sql,args:[]});if(held)await new Promise(resolve=>waiting.push(resolve));else held=true;locked=true;return {rows:[]};}
   return query(sql,args);
  },release:()=>{if(locked)throw Error('TEST_LOCK_LEAK');}};
 }};
 return {pool,states,queries,seed:auth=>{authorization=encrypt(auth);},record:()=>structuredClone(authorization),read:()=>decrypt(),decrypt};
}
module.exports={envConfig,memoryPg};

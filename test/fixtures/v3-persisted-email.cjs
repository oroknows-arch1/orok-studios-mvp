'use strict';
module.exports=async function persistedEmail(pool,campaignId,destinationId){
 const {verifiedReleaseFixture}=await import('./claim-proof.mjs');
 const proof=await verifiedReleaseFixture(campaignId);
 const {destination,asset}=proof.email(destinationId);
 await pool.query('INSERT INTO v3_outlet_directory(outlet_id,record) VALUES($1,$2::jsonb) ON CONFLICT(outlet_id) DO UPDATE SET record=EXCLUDED.record',[destinationId,JSON.stringify(destination)]);
 return {destination,asset,proof:proof.state};
};

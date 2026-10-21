'use strict';
const verified=require('./v3-verified-recipient.cjs');
module.exports=async function persistedEmail(pool,campaignId,destinationId,copy={}){
 const destination=verified(destinationId);
 await pool.query('INSERT INTO v3_outlet_directory(outlet_id,record) VALUES($1,$2::jsonb) ON CONFLICT(outlet_id) DO UPDATE SET record=EXCLUDED.record',[destinationId,JSON.stringify(destination)]);
 return {destination,asset:{campaign_id:campaignId,destination_id:destinationId,kind:'EMAIL',subject:'Evidence-based contribution',body:'Verified editorial correspondence',from:'sean@emradar.net',to:destination.contact.email,contact_status:'VERIFIED',delivery_eligible:true,evidence_ids:['e1'],...copy}};
};

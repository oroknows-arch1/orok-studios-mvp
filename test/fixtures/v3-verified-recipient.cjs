const {createHash}=require('node:crypto');
module.exports=function destination(id='journal',evidence=[{id:'e1',verified:true,fact:'Verified fact',source_url:'https://source.example/fact'}]){
 const email=id+'@journal.example';
 return {id,name:id,category:'news',destination_class:'EDITORIAL_PUBLICATION',website:'https://journal.example',active:true,editorial_fit_verified:true,contact_verified:true,delivery_eligible:true,contact_status:'VERIFIED',evidence:{ids:evidence.map(e=>e.id)},contact:{email,source_url:'https://journal.example/contact',purpose:'general',published_excerpt:'Contact us: '+email,page_sha256:'c'.repeat(64)},verification:{status:'VERIFIED',method:'live_editorial_contact_page',publication_proof_url:'https://journal.example/news',evidence_ids:evidence.map(e=>e.id),scan_evidence_digest:createHash('sha256').update(JSON.stringify(evidence.map(e=>[e.id,e.fact,e.source_url]))).digest('hex')}};
};

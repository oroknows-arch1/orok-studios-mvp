export const reviewPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>EMRADAR · Publication Review</title>
<style>
:root{font-family:system-ui,sans-serif;color:#15212a;background:#f5f7f8}
body{max-width:920px;margin:0 auto;padding:20px}
header{border-bottom:2px solid #123f53;padding-bottom:14px}
article{background:white;border:1px solid #d9e2e7;border-radius:10px;padding:18px;margin:14px 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.55}
button{border:1px solid #123f53;background:white;color:#123f53;padding:10px 14px;border-radius:6px;margin:5px;cursor:pointer}
button:disabled{opacity:.4}
button:focus-visible{outline:3px solid #e0a825}
small{color:#52636d}
</style></head><body><header><h1>EMRADAR · Publication Review</h1><p>Approval saves your decision. Use the separate release control to distribute approved content.</p></header>
<p id="status" role="status">Opening your private review…</p><button id="discover" type="button" disabled>Run Discovery</button><main id="entries"></main>
<script>
'use strict';
let campaign,invitationToken;
const status=document.getElementById('status'),main=document.getElementById('entries');
const csrf=()=>decodeURIComponent((document.cookie.split('; ').find(x=>x.startsWith('emradar_v3_csrf='))||'').split('=').slice(1).join('='));
const api=async(path,payload)=>{
 const response=await fetch('/api/review/'+path,{method:'POST',headers:{'content-type':'application/json','x-emradar-csrf':csrf()},body:JSON.stringify(payload),cache:'no-store',credentials:'same-origin'});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'REQUEST_FAILED');
 return result;
};
const text=(tag,value)=>{
 const el=document.createElement(tag);el.textContent=String(value??'');return el;
};
async function refresh(){
 const view=await api('view',{campaignId:campaign,});
 main.replaceChildren();
 const counts={approved:0,rejected:0,undecided:0};
 for(const entry of view.entries){
  if(entry.decision?.decision==='APPROVE')counts.approved++;
  else if(entry.decision?.decision==='REJECT')counts.rejected++;
  else counts.undecided++;
 }
 const renderedGroups=new Set();
 for(const item of view.entries){
  const {asset,fingerprint,groupKey,decision,delivery}=item;
  const card=document.createElement('article');
  card.append(text('h2',asset.destination_id),text('small','Status: '+(decision?.decision||'Awaiting decision')+(delivery?' · Delivery: '+delivery.status:'')));
  if(asset.kind==='EMAIL')card.append(text('p','Type: '+(asset.correspondence_type==='SOURCE_ENQUIRY'?'Source enquiry':asset.correspondence_type==='EDITORIAL_OUTREACH'?'Editorial outreach':'Legacy unclassified correspondence')),text('p',asset.to?'Recipient: '+asset.to+' · Verification: '+(asset.contact_status||'unknown'):'Recipient unavailable'),text('p',asset.brand_version==='connected-earth-v1'?'Presentation: EMRADAR connected-Earth letterhead · Sean Walker · Research & Editorial':'Presentation: legacy review asset'));
  if(delivery?.receipt)card.append(text('p','Mail receipt: '+(delivery.receipt.provider_id||'unconfirmed')+' · Sent folder: '+(delivery.receipt.sent_folder?.status||'no filing receipt')));
  if(asset.subject)card.append(text('h3',asset.subject));
  card.append(text('pre',asset.body));
  if(asset.kind==='EMAIL' && asset.brand_version==='connected-earth-v1' && asset.html){
   const preview=document.createElement('iframe');preview.title='Reviewed email with EMRADAR letterhead';preview.setAttribute('sandbox','');preview.style='width:100%;height:900px;border:1px solid #d9e2e7';preview.srcdoc=asset.html;card.append(preview);
  }
  if(!delivery){
   const edit=text('button','Edit draft');
   edit.addEventListener('click',async()=>{
    const revised=prompt('Edit draft text',asset.body);
    if(revised===null || revised===asset.body)return;
    edit.disabled=true;
    try{await api('revise',{campaignId:campaign,destinationId:asset.destination_id,fingerprint,changes:{body:revised}});await refresh();status.textContent='Revision saved. Approve the updated version when ready.';}
    catch(e){status.textContent='Revision not saved. Reload and retry.';edit.disabled=false;}
   });
   card.append(edit);
   if(asset.kind==='EMAIL'){
    const editSubject=text('button','Edit subject');
    editSubject.addEventListener('click',async()=>{
     const revised=prompt('Edit email subject',asset.subject);
     if(revised===null || revised===asset.subject)return;
     editSubject.disabled=true;
     try{await api('revise',{campaignId:campaign,destinationId:asset.destination_id,fingerprint,changes:{subject:revised}});await refresh();status.textContent='Subject saved. Approve the updated email when ready.';}
     catch(e){status.textContent='Subject not saved. Reload and retry.';editSubject.disabled=false;}
    });
    card.append(editSubject);
   }
  }
  if(asset.kind==='X'&&!delivery)card.append(text('p','Approval does not publish this post. Release checks the account, graphic and publication history before posting.'));
  if(asset.kind==='X' && asset.visual_url){
   const link=document.createElement('a');const visual=new URL(asset.visual_url,location.origin);if(visual.protocol==='https:'){link.href=visual.href;link.rel='noopener noreferrer';link.target='_blank';link.textContent='View accompanying graphic';card.append(link);}
  }
  if((asset.kind==='X'||(asset.kind==='EMAIL'&&asset.to))&&decision?.decision==='APPROVE'&&!delivery){
   const isX=asset.kind==='X';
   const send=text('button',isX?'Publish approved X post':'Send approved email');
   send.addEventListener('click',async()=>{
    if(!confirm(isX?'Publish this exact approved text and graphic to the configured X account?':'Send this exact approved email to '+asset.to+'?'))return;
    send.disabled=true;
    try{await api('release',{campaignId:campaign,destinationId:asset.destination_id});await refresh();status.textContent=isX?'X accepted the post. Its receipt is saved with this asset.':'Mail accepted. The receipt and Sent-folder result are shown with this email.';}
    catch(e){await refresh();status.textContent='Send was blocked or its result is uncertain. Check the saved delivery record before trying again.';}
   });
   card.append(send);
  }
  for(const choice of ['APPROVE','REJECT']){
   const button=text('button',choice==='APPROVE'?'Approve':'Reject');
   button.disabled=!!delivery;
   button.addEventListener('click',async()=>{
    button.disabled=true;
    try{await api('decision',{campaignId:campaign,destinationId:asset.destination_id,decision:choice,fingerprint});await refresh();}
    catch(e){status.textContent='Could not save decision. Please retry.';button.disabled=false;}
   });
   card.append(button);
  }
  if(groupKey && !renderedGroups.has(groupKey) && view.entries.filter(e=>e.groupKey===groupKey).length>1 && view.entries.some(e=>e.groupKey===groupKey && !e.decision && !e.delivery)){
   renderedGroups.add(groupKey);
   for(const choice of ['APPROVE','REJECT']){
    const button=text('button',choice==='APPROVE'?'Approve identical undecided emails':'Reject identical undecided emails');
    button.addEventListener('click',async()=>{button.disabled=true;try{await api('group',{campaignId:campaign,groupKey,decision:choice});await refresh();}catch(e){status.textContent='Could not save group decision.';button.disabled=false;}});
    card.append(button);
   }
  }
  main.append(card);
 }
 status.textContent='Review: '+view.entries.length+' items · '+counts.approved+' approved · '+counts.rejected+' rejected · '+counts.undecided+' awaiting decision.';
}
(async()=>{
 try{
  const params=new URLSearchParams(location.hash.slice(1));
  const token=params.get('token');invitationToken=token;campaign=params.get('campaign');
  campaign=campaign||new URLSearchParams(location.search).get('campaign');
  if(!campaign)throw Error('MISSING_CAMPAIGN');
  history.replaceState(null,'',location.pathname+'?campaign='+encodeURIComponent(campaign));
  // The invitation authenticates once; reopening uses the existing secure cookie.
  try{await refresh();}
  catch(error){
   if(!token)throw error;
   const exchanged=await api('exchange',{campaignId:campaign,token});
   if(!exchanged.expiresAt)throw Error('SESSION_MISSING');
   await refresh();
  }
  const discover=document.getElementById('discover');discover.disabled=false;
  discover.addEventListener('click',async()=>{
   discover.disabled=true;status.textContent='Discovering evidence-matched destinations and preparing review drafts…';
   try{const result=await api('discover',{campaignId:campaign});await refresh();status.textContent+=' Discovery: '+(result.editorial_drafts??0)+' new drafts.';}
   catch(e){status.textContent='Discovery could not complete: '+e.message;}
   finally{discover.disabled=false;}
  });
 }catch(e){
  status.textContent='Your saved sign-in has expired or is unavailable on this device. Your approvals are preserved.';
  if(campaign){
   const renew=text('button','Email me a fresh private sign-in link');
   renew.addEventListener('click',async()=>{
    renew.disabled=true;
    try{const result=await api('request-access',{campaignId:campaign,token:invitationToken});status.textContent=result.status==='EXISTING_INVITATION'?'Use the latest private invitation already sent to sean@emradar.net.':'Your private invitation was accepted for sending to sean@emradar.net. Inbox arrival is not yet confirmed.';}
    catch(error){status.textContent='A sign-in link was already requested today, or its delivery is uncertain. No duplicate was sent.';}
   });main.replaceChildren(renew);
  }
 }
})();
</script></body></html>`;

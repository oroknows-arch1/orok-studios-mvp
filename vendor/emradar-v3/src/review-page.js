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
.review-graphic{display:block;max-width:100%;height:auto;margin:16px 0}
</style></head><body><header><h1>EMRADAR · Publication Review</h1><p>Approval saves your decision. Use the separate release control to distribute approved content.</p></header>
<p id="status" role="status">Opening your private review…</p><button id="discover" type="button" disabled>Run Discovery</button><button id="connect-x" type="button" disabled>Connect X</button><button id="check-x" type="button" disabled>Check X connection</button><main id="entries"></main>
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
 if(view.xThread){
  const thread=view.xThread,section=document.createElement('section');
  section.append(text('h2','Complete X thread'),text('p','All posts appear below in publication order. Each reply attaches to the preceding post.'),text('small',thread.scan?.source_key||''));
  const images=[];
  for(const segment of thread.segments){
   const card=document.createElement('article');
   card.append(text('h3','Post '+segment.sequence+' · '+segment.kind+(segment.record_id?' · '+segment.record_id:'')),text('p',segment.parent_sequence?'Reply to post '+segment.parent_sequence:'Main post'),text('pre',segment.text));
   for(const source of segment.source_links??[]){const link=text('a',source);link.href=source;link.rel='noopener noreferrer';link.target='_blank';card.append(link,text('br',''));}
   if(segment.media){
    const image=document.createElement('img');image.className='review-graphic';image.alt='Exact graphic for post '+segment.sequence;
    images.push(new Promise(resolve=>{image.addEventListener('load',()=>resolve(true));image.addEventListener('error',()=>resolve(false));}));
    image.src='data:'+segment.media.mime+';base64,'+segment.media.base64;card.append(image);
   }
   card.append(text('small',segment.asset_sha256));
   const edit=text('button','Edit post '+segment.sequence);edit.addEventListener('click',async()=>{
    const revised=prompt('Edit complete X post text',segment.text);if(revised===null||revised===segment.text)return;
    edit.disabled=true;try{await api('revise',{campaignId:campaign,destinationId:'x',fingerprint:thread.manifest_sha256,changes:{sequence:segment.sequence,text:revised}});await refresh();status.textContent='X edit saved. Previous approval cleared.';}catch{status.textContent='X edit was not saved. Reload and retry.';edit.disabled=false;}
   });card.append(edit);section.append(card);
  }
  for(const problem of thread.problems??[])section.append(text('p','X approval blocked: '+problem));
  section.append(text('p','Decision: '+(thread.approval?.decision||'Awaiting owner review')));
  const approve=text('button','Approve complete X thread');approve.disabled=true;
  approve.addEventListener('click',async()=>{approve.disabled=true;try{await api('decision',{campaignId:campaign,destinationId:'x',decision:'APPROVE',fingerprint:thread.manifest_sha256});await refresh();status.textContent='Exact X thread approval saved.';}catch{status.textContent='X approval was blocked. Reload the complete preview.';}});
  section.append(approve);
  const reject=text('button','Reject X thread');reject.disabled=!thread.manifest_sha256;reject.addEventListener('click',async()=>{reject.disabled=true;try{await api('decision',{campaignId:campaign,destinationId:'x',decision:'REJECT',fingerprint:thread.manifest_sha256});await refresh();}catch{status.textContent='X rejection was not saved.';}});section.append(reject);
  main.append(section);
  // Acknowledge only after every card is mounted and every graphic decoded.
  Promise.all(images).then(async loaded=>{
   if(!thread.ready||loaded.some(ok=>!ok)||!thread.segments.length)return;
   try{await api('thread-present',{campaignId:campaign,manifest_sha256:thread.manifest_sha256,segment_hashes:thread.segments.map(s=>s.asset_sha256)});approve.disabled=false;}catch{status.textContent='Complete X preview could not be verified. Approval remains unavailable.';}
  });
 }
 const counts={approved:0,rejected:0,undecided:0};
 for(const entry of view.entries){
  if(entry.decision?.decision==='APPROVE')counts.approved++;
  else if(entry.decision?.decision==='REJECT')counts.rejected++;
  else counts.undecided++;
 }
 const sharedGroups=new Map((view.groups??[]).filter(group=>group.destination_ids.length>1).map(group=>[group.id,group]));
 for(const group of sharedGroups.values()){
  const members=group.destination_ids.map(id=>view.entries.find(entry=>entry.asset.destination_id===id));
  const card=document.createElement('article');card.append(text('h2','Shared publication email · '+members.length+' recipients'),text('small','Version '+group.version+' · '+(group.approval?.decision||'Awaiting group decision')));
  if(group.subject)card.append(text('h3',group.subject));card.append(text('pre',group.body),text('p','Included verified publications:'));
  const list=document.createElement('ul');
  for(const member of members){
   const row=document.createElement('li');row.append(text('span',(member.destination?.name||member.asset.destination_id)+' · '+member.asset.to));
   if(member.delivery)row.append(text('small',' · Delivery: '+member.delivery.status+(member.delivery.receipt?.provider_id?' · Receipt: '+member.delivery.receipt.provider_id:'')));
   if(!members.some(item=>item.delivery))for(const action of ['EXCLUDE','SPLIT']){const button=text('button',action==='EXCLUDE'?'Exclude recipient':'Split to individual');button.addEventListener('click',async()=>{button.disabled=true;try{await api('group-member',{campaignId:campaign,groupId:group.id,destinationId:member.asset.destination_id,contentHash:group.content_hash,version:group.version,action});await refresh();}catch{status.textContent='Group membership was not changed. Reload and retry.';button.disabled=false;}});row.append(button);}
   if(group.approval?.decision==='APPROVE'&&!member.delivery){const send=text('button','Send approved email');send.disabled=view.publishing?.email?.enabled===false;send.addEventListener('click',async()=>{if(!confirm('Send this exact approved email to '+member.asset.to+'?'))return;send.disabled=true;try{await api('release',{campaignId:campaign,destinationId:member.asset.destination_id});await refresh();}catch{await refresh();status.textContent='Release was blocked or uncertain. Check the saved delivery record.';}});row.append(send);}
   list.append(row);
  }
  card.append(list);
  if(!members.some(member=>member.delivery)){
   const editSubject=text('button','Edit shared subject');editSubject.addEventListener('click',async()=>{const revised=prompt('Edit shared email subject',group.subject);if(revised===null||revised===group.subject)return;editSubject.disabled=true;try{await api('group-revise',{campaignId:campaign,groupId:group.id,contentHash:group.content_hash,version:group.version,changes:{subject:revised}});await refresh();status.textContent='Shared subject saved. The new version requires approval.';}catch{status.textContent='Shared subject was not saved. Reload and retry.';editSubject.disabled=false;}});
   const editBody=text('button','Edit shared body');editBody.addEventListener('click',async()=>{const revised=prompt('Edit shared email body',group.body);if(revised===null||revised===group.body)return;editBody.disabled=true;try{await api('group-revise',{campaignId:campaign,groupId:group.id,contentHash:group.content_hash,version:group.version,changes:{body:revised}});await refresh();status.textContent='Shared body saved. The new version requires approval.';}catch{status.textContent='Shared body was not saved. Reload and retry.';editBody.disabled=false;}});
   card.append(editSubject,editBody);
   if(!group.approval)for(const decision of ['APPROVE','REJECT']){const button=text('button',decision==='APPROVE'?'Approve Group':'Reject Group');button.addEventListener('click',async()=>{button.disabled=true;try{await api('group',{campaignId:campaign,groupId:group.id,contentHash:group.content_hash,version:group.version,decision});await refresh();}catch{status.textContent='The group decision was not saved. Reload and retry.';button.disabled=false;}});card.append(button);}
  }
  main.append(card);
 }
 for(const item of [...view.entries,...(view.history??[])]){
  const {asset,fingerprint,groupId,decision,delivery,historical}=item;
  if(view.xThread&&asset.kind==='X'&&!historical)continue;
  if(!historical&&sharedGroups.has(groupId))continue;
  const card=document.createElement('article');
  card.append(text('h2',item.destination?.name||asset.destination_id),text('small',historical?item.label:'Editorial decision: '+(decision?.decision||'Awaiting decision')));
  if(!historical&&item.revision)card.append(text('p','Edited · Saved · Revision '+item.revision.id+' · '+fingerprint));
  card.append(text('p','Preparation: '+(asset.review_status||'READY')),text('p','Delivery: '+(historical?'Historical content; current version is reviewed separately.':delivery?.status||'Not released')));
  if(!historical&&item.review_action){
   const action=item.review_action;
   const labels={NEEDS_FEEDBACK:'Rejection saved — owner feedback is needed before regeneration.',PENDING:'Regeneration queued.',RUNNING:'Regeneration in progress.',OWNER_REVIEW_PENDING:'Revised content is ready; owner review notification is pending.',COMPLETE:'Revised content is ready for owner review.',FAILED:'Regeneration failed; the rejected draft remains unchanged.',NOTIFICATION_AMBIGUOUS:'Review notification outcome is uncertain; it will not be resent automatically.',CANCELLED:'Regeneration was cancelled by a later owner decision.'};
   card.append(text('p',labels[action.status]||'Regeneration status: '+action.status));
  }
  if(!historical)for(const note of item.rejection_feedback??[])if(note.feedback)card.append(text('p','Owner feedback: '+note.feedback));
  if(asset.preparation_error)card.append(text('p','Needs revision: '+asset.preparation_error));
  if(asset.kind==='EMAIL')card.append(text('p','Type: '+(asset.correspondence_type==='SOURCE_ENQUIRY'?'Source enquiry':asset.correspondence_type==='EDITORIAL_OUTREACH'?'Editorial outreach':'Legacy unclassified correspondence')),text('p',asset.to?'Recipient: '+asset.to+' · Verification: '+(asset.contact_status||'unknown'):'Recipient unavailable'),text('p',asset.brand_version==='connected-earth-v1'?'Presentation: EMRADAR connected-Earth letterhead · Sean Walker · Research & Editorial':'Presentation: legacy review asset'));
  if(item.recipient_warning)card.append(text('p','Automated verification warning: '+item.recipient_warning+'. The owner-saved address remains available for review; approve this exact email before release.'));
  if(delivery?.receipt)card.append(text('p',asset.kind==='X'?'X receipt: '+(delivery.receipt.provider_id||'unconfirmed'):'Mail receipt: '+(delivery.receipt.provider_id||'unconfirmed')+' · Sent folder: '+(delivery.receipt.sent_folder?.status||'no filing receipt')));
  if(asset.subject)card.append(text('h3',asset.subject));
  card.append(text('pre',asset.body));
  if(asset.kind==='EMAIL' && asset.html){
   const preview=document.createElement('iframe');preview.title='Reviewed email with EMRADAR letterhead';preview.setAttribute('sandbox','');preview.style='width:100%;height:900px;border:1px solid #d9e2e7';preview.srcdoc=asset.html;card.append(preview);
  }
  if(!delivery&&!historical){
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
    const editRecipient=text('button','Edit recipient');
    editRecipient.addEventListener('click',()=>{
     editRecipient.disabled=true;
     const form=document.createElement('form');
     const label=text('label','Email recipient address ');
     const input=document.createElement('input');input.type='email';input.required=true;input.autocomplete='email';input.value=asset.to||'';input.setAttribute('aria-label','Recipient email address');
     const save=text('button','Save');save.type='submit';
     const cancel=text('button','Cancel');cancel.type='button';
     cancel.addEventListener('click',()=>{form.remove();editRecipient.disabled=false;});
     form.addEventListener('submit',async event=>{
      event.preventDefault();if(!input.reportValidity())return;
      save.disabled=true;cancel.disabled=true;
      try{const result=await api('revise',{campaignId:campaign,destinationId:asset.destination_id,fingerprint,changes:{to:input.value.trim()}});await refresh();status.textContent=result.recipient_warning?'Recipient saved with an automated verification warning ('+result.recipient_warning+'). Previous approval cleared; approve the updated email before release.':'Recipient saved and verified. Previous approval cleared; approve the updated email before release.';}
      catch{status.textContent='Recipient was not saved. Check the address, then reload and retry.';save.disabled=false;cancel.disabled=false;}
     });
     label.append(input);form.append(label,save,cancel);card.append(form);input.focus();
    });
    card.append(editRecipient);
   }
  }
  if(asset.kind==='X'&&!delivery)card.append(text('p','Approval does not publish this post. Release checks the account, graphic and publication history before posting.'));
  if(asset.kind==='X'){
   const mime=asset.visual_mime;
   const stored=asset.visual_base64&&['image/png','image/jpeg','image/webp','image/gif'].includes(mime)?'data:'+mime+';base64,'+asset.visual_base64:null;
   let source=stored;
   if(!source&&asset.visual_url){
    try{const url=new URL(asset.visual_url,location.origin);if((url.protocol==='https:'&&!url.username&&!url.password)||['image/png','image/jpeg','image/webp','image/gif'].some(type=>asset.visual_url.startsWith('data:'+type+';base64,')))source=url.href;}catch{}
   }
   if(source){
    const image=document.createElement('img');image.className='review-graphic';image.alt='Actual graphic accompanying the proposed X post';image.src=source;
    image.addEventListener('error',()=>{card.append(text('p','The saved graphic could not be displayed. The draft remains available for review.'));});
    card.append(image);
   }else card.append(text('p','No displayable graphic is saved with this X draft.'));
  }
  if(!historical){
   const isX=asset.kind==='X',capability=view.publishing?.[isX?'x':'email'];
   const unavailable=delivery?'A delivery has already been recorded. It will not be repeated.':
    (!isX&&(!asset.to||item.recipient_ready===false))?'A verified recipient is required for delivery. Editorial review remains available.':
    capability?.enabled===false?(capability.reason||'Publishing is unavailable. Editorial review remains available.'):
    decision?.decision!=='APPROVE'?'Approve this draft before releasing it.':null;
   if(unavailable)card.append(text('p',unavailable));
   const send=text('button',isX?'Publish approved X post':'Send approved email');
   send.disabled=!!unavailable;
   send.addEventListener('click',async()=>{
    if(!confirm(isX?'Publish this exact approved text and graphic to the configured X account?':'Send this exact approved email to '+asset.to+'?'))return;
    send.disabled=true;
    try{await api('release',{campaignId:campaign,destinationId:asset.destination_id});await refresh();status.textContent=isX?'X accepted the post. Its receipt is saved with this asset.':'Mail accepted. The receipt and Sent-folder result are shown with this email.';}
    catch(e){await refresh();status.textContent='Release was blocked or its result is uncertain. Check the saved delivery record before trying again.';}
   });
   card.append(send);
  }
  if(!historical)for(const choice of ['APPROVE','REJECT','REGENERATE','EXCLUDE']){
   const button=text('button',choice==='APPROVE'?'Approve':choice==='REJECT'?'Reject':choice==='REGENERATE'?'Regenerate':'Exclude');
   button.disabled=!!delivery;
   if(choice==='APPROVE'&&asset.review_status==='NEEDS_REVISION')button.disabled=true;
   button.addEventListener('click',async()=>{
    let feedback='';
    if(choice==='REJECT'||choice==='REGENERATE'){
     const response=prompt('What should change? Leave blank to save the rejection and request clarification before regeneration.',item.review_action?.feedback||'');
     if(response===null)return;
     feedback=response;
    }
    button.disabled=true;
    try{const result=await api('decision',{campaignId:campaign,destinationId:asset.destination_id,decision:choice,fingerprint,feedback});await refresh();if(result.regeneration_status==='NEEDS_FEEDBACK')status.textContent='Rejection saved. Add specific feedback before this item can be regenerated.';else if(result.regeneration_status==='PENDING')status.textContent='Rejection and feedback saved. Regeneration is queued; the revised item will return to owner review.';}
    catch(e){status.textContent='Could not save decision. Please retry.';button.disabled=false;}
   });
   card.append(button);
  }
  if(!historical&&!delivery&&item.review_action?.status==='NEEDS_FEEDBACK'){
   const addFeedback=text('button','Add feedback for regeneration');
   addFeedback.addEventListener('click',async()=>{
    const feedback=prompt('What specifically should change?');if(feedback===null)return;
    addFeedback.disabled=true;
    try{const result=await api('decision',{campaignId:campaign,destinationId:asset.destination_id,decision:'REGENERATE',fingerprint,feedback});await refresh();status.textContent=result.regeneration_status==='PENDING'?'Feedback saved. Regeneration is queued for owner review.':'Rejection saved. Add specific feedback before regeneration.';}
    catch{status.textContent='Feedback was not saved. Please retry.';addFeedback.disabled=false;}
   });
   card.append(addFeedback);
  }
  main.append(card);
 }
 status.textContent=(view.phase==='ASSETS_PREPARED'?'Preparation incomplete — all saved content remains available. ':'')+'Review: '+view.entries.length+' items · '+counts.approved+' approved · '+counts.rejected+' rejected · '+counts.undecided+' awaiting decision.'+((view.history??[]).length?' Historical drafts: '+view.history.length+'.':'');
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
  const connectX=document.getElementById('connect-x'),checkX=document.getElementById('check-x');
  connectX.disabled=false;checkX.disabled=false;
  connectX.addEventListener('click',async()=>{
   connectX.disabled=true;
   try{const result=await api('x/connect',{campaignId:campaign});const url=new URL(result.authorization_url);if(url.origin!=='https://x.com'||url.pathname!=='/i/oauth2/authorize')throw Error();location.assign(url.href);}
   catch{status.textContent='X connection is unavailable. Your review and approvals are preserved.';connectX.disabled=false;}
  });
  checkX.addEventListener('click',async()=>{
   checkX.disabled=true;
   try{const result=await api('x/status',{campaignId:campaign});status.textContent='X connected: @'+result.username+'. Publishing still requires separate release.';}
   catch{status.textContent='X connection could not be verified. Use Connect X if reconnection is needed.';}
   finally{checkX.disabled=false;}
  });
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

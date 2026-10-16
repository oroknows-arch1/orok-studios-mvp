import {createHash} from 'node:crypto';
import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const host=value=>new URL(value).hostname.toLowerCase().replace(/^www\./,'');
const emails=/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const decode=value=>String(value).replace(/&#(?:x([a-f\d]+)|(\d+));?/gi,(_,hex,n)=>String.fromCodePoint(parseInt(hex??n,hex?16:10))).replace(/&(?:amp|nbsp|quot|apos|lt|gt);/gi,m=>({'&amp;':'&','&nbsp;':' ','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[m.toLowerCase()]));
const text=value=>decode(value.replace(/<[^>]*>/g,' ')).replace(/[ \t]+/g,' ').trim();
const relevant=/contact|about|editorial|editors|newsroom|staff|team|contribut|submission|send.us.news/i;
const forbidden=/website issues|online department|advertis|subscription|circulation|sponsor|\bsales\b|website assistance|technical|\bsupport\b|privacy|legal|accounts|careers|customer service|administrati|events|webinars/i;
export function publicContactUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!/^\[|^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)&&u.hostname.includes('.')&&!/(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname)?u:null;}catch{return null;}}
function visibleHtml(html){
 return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<!--[\s\S]*?-->/g,'').replace(/<span\b[^>]*data-cfemail=["']([a-f\d]+)["'][^>]*>[\s\S]*?<\/span>/gi,(_,encoded)=>{
  if(encoded.length<4||encoded.length%2)return '';
  const key=parseInt(encoded.slice(0,2),16);return encoded.slice(2).match(/../g).map(b=>String.fromCharCode(parseInt(b,16)^key)).join('');
 }).replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,(whole,attrs,label)=>{
  const href=attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1];let address='';
  if(href?.toLowerCase().startsWith('mailto:')){try{address=decodeURIComponent(decode(href).slice(7).split('?')[0]);}catch{}}
  const title=decode(attrs.match(/\btitle\s*=\s*["']([^"']*)["']/i)?.[1]??'');
  return label+' '+(recipientPolicy.validRecipient(address)?address:recipientPolicy.validRecipient(title)?title:'');
 });
}
export function navigationLinks(html,url){
 const found=[];
 for(const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const label=text(match[2]);let target;try{target=publicContactUrl(new URL(decode(match[1]),url).href);}catch{continue;}
  if(!target||target.search||!relevant.test(label+' '+target.pathname)||!(/^(?:contact(?: us)?|about(?: us)?|editorial|editors|newsroom|our team|team|staff|contributors|submissions|publisher)$/i.test(label)||/\/(?:contact(?:-us)?|about(?:-us)?|editorial|editors|newsroom|staff|team|contributors|submissions)(?:[/.\-]|$)/i.test(target.pathname)))continue;target.hash='';
  found.push({url:target.href,label,priority:/contact/i.test(label+' '+target.pathname)?0:/editor|staff|team|newsroom|submission|contribut/i.test(label+' '+target.pathname)?1:2});
 }
 return found.sort((a,b)=>a.priority-b.priority||a.url.localeCompare(b.url));
}
export function extractPublicationContacts(html,{url,publication,topics=[]}){
 const prepared=visibleHtml(html).replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,(_,level,label)=>'\n@@HEADING '+text(label)+'@@\n').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:p|li|tr|div)>/gi,'\n\n');
 let heading='';const contacts=[],seen=new Set();
 for(const group of prepared.split(/(@@HEADING [\s\S]*?@@)/)){
  if(group.startsWith('@@HEADING ')){heading=group.slice(10,-2).trim();continue;}
  for(const raw of group.split(/\n\s*\n/)){
   const block=text(raw);const addresses=block.match(emails)??[];
   for(const address of addresses){
    const email=address.toLowerCase();if(!recipientPolicy.validRecipient(email)||seen.has(email))continue;seen.add(email);
    const roleText=block.replace(emails,'').trim(),context=(heading+' '+roleText).trim();
    let purpose=null,rank=99,reason='NO_EDITORIAL_PURPOSE';
    if(forbidden.test(context))reason='NON_EDITORIAL_ROLE';
    else if(/editor\b/i.test(context)&&!/editorial (?:enquir|inquir)/i.test(context)){
     purpose='named_editor';rank=1;
     if(topics.some(topic=>String(topic).length>3&&context.toLowerCase().includes(String(topic).toLowerCase()))){rank=0;}
    }else if(/editorial|newsroom|news desk/i.test(context)){purpose='editorial';rank=2;}
    else if(/submission|contribut|pitch|send.us.news/i.test(context)){purpose='submissions';rank=3;}
    else if(/general (?:enquir|inquir)|contact us|get in touch/i.test(context)){purpose='general';rank=4;}
    const lines=decode(raw.replace(/<[^>]*>/g,' ')).split(/\n/).map(s=>s.trim()).filter(Boolean);
    const name=purpose==='named_editor'?lines.find(line=>/^[A-Z][A-Za-z’'.-]+(?:\s+[A-Z][A-Za-z’'.-]+){1,3}$/.test(line)&&!/(?:editor|contact|email|news|phone)/i.test(line))??null:null;
    contacts.push({email,publication,name,role:context.slice(0,1200),purpose,rank,eligible:Boolean(purpose),rejection_reason:purpose?null:reason,source_url:url,published_excerpt:(heading+'\n'+block).slice(0,3000),page_sha256:hash(html),checked_at:new Date().toISOString()});
   }
  }
 }
 return contacts;
}
export function createEditorialContactResearch({read,maxPages=6,maxMs=45000}={}){
 if(typeof read!=='function')throw Error('CONTACT_READER_REQUIRED');
 const executions=new Map();
 return input=>{
  const website=publicContactUrl(input.website);if(!website)return Promise.resolve({status:'OFFICIAL_SITE_UNAVAILABLE',primary:null,alternatives:[],pages:[]});
  const key=host(website.href);if(executions.has(key))return executions.get(key);
  const run=(async()=>{
   const started=Date.now(),queue=[{url:website.href,path:[]},...(input.sourceUrls??[]).map(publicContactUrl).filter(u=>u&&host(u.href)===host(website.href)&&u.href!==website.href).map(u=>({url:u.href,path:[]}))],visited=new Set(),pages=[],contacts=[],failures=[];
   while(queue.length&&visited.size<maxPages&&Date.now()-started<maxMs){
    const next=queue.shift();if(visited.has(next.url))continue;visited.add(next.url);
    let html;try{html=await read(new URL(next.url));}catch(error){failures.push({url:next.url,reason:error.message});continue;}
    pages.push({url:next.url,page_sha256:hash(html)});
    contacts.push(...extractPublicationContacts(html,{url:next.url,publication:input.publication,topics:input.topics}).map(c=>({...c,publisher_attribution:next.path})));
    for(const link of navigationLinks(html,next.url)){
     if(visited.has(link.url)||queue.some(q=>q.url===link.url))continue;
     const external=host(link.url)!==host(website.href);
     // Cross-domain research requires a direct official navigation link; never follow arbitrary third parties.
     if(external&&(!/contact|editor|publisher|about/i.test(link.label)||next.path.length>=2))continue;
     queue.push({url:link.url,path:[...next.path,{from_url:next.url,to_url:link.url,link_text:link.label,page_sha256:hash(html)}],priority:link.priority});
    }
    queue.sort((a,b)=>(a.priority??0)-(b.priority??0));
   }
   const unique=new Map();
   for(const c of contacts){const old=unique.get(c.email);if(!old||c.rank<old.rank)unique.set(c.email,c);}
   const all=[...unique.values()],ranked=all.filter(c=>c.eligible&&c.purpose!=='general').sort((a,b)=>a.rank-b.rank||a.email.localeCompare(b.email));
   const selected=ranked.length?ranked:all.filter(c=>c.purpose==='general').sort((a,b)=>a.email.localeCompare(b.email));
   // Never select while relevant navigation remains uninspected because the budget ended.
   const complete=!queue.some(q=>!visited.has(q.url));
   const primary=selected[0]??null;
   return {status:primary?(primary.purpose==='general'?'GENERAL_FALLBACK_VERIFIED':'EDITORIAL_CONTACT_VERIFIED'):!complete?'RESEARCH_BUDGET_EXHAUSTED':pages.length?'NO_RELEVANT_PUBLISHED_CONTACT':'OFFICIAL_SITE_UNAVAILABLE',primary,alternatives:primary&&primary.purpose!=='general'?selected.slice(1,3).map(c=>({...c,selection_reason:'Distinct published editorial contact; alternative only, never copied automatically.'})):[],contacts:all,pages,failures,requests:visited.size};
  })();executions.set(key,run);return run;
 };
}

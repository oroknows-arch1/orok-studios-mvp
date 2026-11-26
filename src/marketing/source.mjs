import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpsRequest} from 'node:https';
import {convert} from 'html-to-text';
function publicHttps(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!['localhost','127.0.0.1','0.0.0.0','::1'].includes(u.hostname)&&u.hostname.includes('.')&&!u.hostname.endsWith('.local')&&!u.hostname.endsWith('.internal')?u:null;}catch{return null;}}
function publicAddress(address){if(isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===192&&p[1]===0)||(p[0]===198&&p[1]>=18&&p[1]<=19));}return isIP(address)===6 && /^[23]/.test(address) && !/^(2001:|2002:)/i.test(address);}
export const pinnedLookup=address=>(_hostname,options,callback)=>options?.all===true?callback(null,[{address,family:isIP(address)}]):callback(null,address,isIP(address));
export async function pinnedSource(url,resolver,{timeoutMs=12000,maxBytes=1000000,allowPdf=false,redirects=0}={}){
 const urlIsPublic=publicHttps(url.href);
 if(!urlIsPublic || isIP(url.hostname))throw Error('CONTACT_ADDRESS_UNSAFE');
 const addresses=await resolver(url.hostname,{all:true,verbatim:true});
 if(!addresses?.length||!addresses.every(item=>publicAddress(item.address)))throw Error('CONTACT_ADDRESS_UNSAFE');
 return new Promise((resolve,reject)=>{
  const req=httpsRequest(url,{method:'GET',lookup:pinnedLookup(addresses[0].address),headers:{accept:allowPdf?'text/html, application/pdf':'text/html'},rejectUnauthorized:true},res=>{
   if(redirects>0&&[301,302,303,307,308].includes(res.statusCode)&&res.headers.location){
    res.destroy();
    try{resolve(pinnedSource(new URL(res.headers.location,url),resolver,{timeoutMs,maxBytes,allowPdf,redirects:redirects-1}));}
    catch(error){reject(error);}
    return;
   }
   const type=String(res.headers['content-type']??'').toLowerCase();
   if(res.statusCode!==200||(!type.includes('text/html')&&!(allowPdf&&type.includes('application/pdf')))){
    res.destroy();
    reject(Error(res.statusCode===403?'CONTACT_HTTP_403':'CONTACT_RESPONSE_INVALID'));
    return;
   }
   let size=0;
   const chunks=[];
   res.on('data',chunk=>{
    size+=chunk.length;
    if(size>maxBytes)res.destroy(Error('CONTACT_TOO_LARGE'));
    else chunks.push(chunk);
   });
   res.on('end',()=>resolve({url:url.href,type,bytes:Buffer.concat(chunks)}));
   res.on('error',reject);
  });
  const timer=setTimeout(()=>req.destroy(Error('CONTACT_TIMEOUT')),timeoutMs);
  req.on('close',()=>clearTimeout(timer));
  req.on('error',reject);
  req.end();
 });
}

export async function readSource(raw) {
 const page=await pinnedSource(new URL(raw),lookup,{allowPdf:true,redirects:2});
 if(page.type.includes('application/pdf')) {
   const {extractText}=await import('unpdf');
   const parsed=await extractText(new Uint8Array(page.bytes),{mergePages:true});
   return String(parsed.text);
 }
 return convert(page.bytes.toString('utf8'),{wordwrap:false,selectors:[{selector:'nav',format:'skip'},{selector:'footer',format:'skip'},{selector:'img',format:'skip'}]});
}

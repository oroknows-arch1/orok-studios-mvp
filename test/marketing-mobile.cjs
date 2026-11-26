'use strict';
// Run under CI Chrome with fake outbound providers and the real owner HTTP handler.
const {chromium}=require(process.env.MARKETING_PLAYWRIGHT);
const assert=require('node:assert/strict');
async function run(){
 const {OwnerAccess}=await import('../vendor/emradar-v3-authoritative/clean/access.js');
 const {createReviewServer}=await import('../vendor/emradar-v3-authoritative/clean/http.js');
 const {createOwnerActions}=await import('../vendor/emradar-v3-authoritative/clean/owner.js');
 const {Workspace,fingerprint}=await import('../vendor/emradar-v3-authoritative/clean/workspace.js');
 const records=new Map(),id='v3-mobile-test',origin='https://review.example.org';
 const adapter={read:async k=>structuredClone(records.get(k)),compareAndSwap:async(k,v,value)=>{if((records.get(k)?.version??null)!==v)return false;records.set(k,{version:(v??0)+1,value});return true}};
 const asset={kind:'EMAIL',campaign_id:id,destination_id:'a',subject:'Factory approval',body:'Initial copy',to:'editor@example.org',review_status:'READY'};
 const state={id,phase:'PUBLICATION_REVIEW',scan:{snapshot_date:'2026-11-25'},assets:{a:{asset,fingerprint:fingerprint(asset)}},destinations:[],decisions:{},deliveries:{}};
 await adapter.compareAndSwap(id,null,state);
 const workspace=new Workspace({adapter,formatEmail:a=>a,checkRecipient:()=>true});
 let invitation;
 const access=new OwnerAccess({adapter,baseUrl:origin,notify:async({recipient,link,campaignId})=>{invitation=link;return {recipient,campaign_id:campaignId,accepted:true,provider_id:'mock-invite'}}});
 await access.issue(id);
 const ownerAction=createOwnerActions({workspace,access,read:async()=>'',askFor:()=>async()=>({subject:'Revised factory approval',body:'Revised pitch about future leasing.',summary:'Changed the tenant angle.',unknowns:['Occupancy'],facts:[]})});
 const server=createReviewServer({workflow:access,ownerAction});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await ctx.route(origin+'/**',async route=>{
   const req=route.request(),target=new URL(req.url()),headers=await req.allHeaders();
   const response=await fetch('http://127.0.0.1:'+server.address().port+target.pathname+target.search,{method:req.method(),headers,body:req.postData()||undefined});
   // Forward multiple Set-Cookie headers independently via the browser's cookie API.
   const cookies=response.headers.getSetCookie();
   for(const value of cookies){const [pair,...attrs]=value.split('; '),idx=pair.indexOf('=');
    await ctx.addCookies([{name:pair.slice(0,idx),value:pair.slice(idx+1),domain:target.hostname,path:attrs.find(x=>x.startsWith('Path='))?.slice(5)||'/',httpOnly:attrs.includes('HttpOnly'),secure:true,sameSite:'Strict'}]);}
   const outgoing=Object.fromEntries(response.headers);delete outgoing['set-cookie'];
   await route.fulfill({status:response.status,headers:outgoing,body:Buffer.from(await response.arrayBuffer())});
 });
 const page=await ctx.newPage();await page.goto(invitation);
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 let dialog=page.getByRole('dialog');const box=await dialog.boundingBox();assert.ok(box.width>=380&&box.height>=800);
 await dialog.getByLabel('Proposal').fill('Owner edit');await dialog.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByText('Owner edit',{exact:true}).waitFor();await page.reload();
 await page.getByText('Owner edit',{exact:true}).waitFor();await page.getByRole('button',{name:'Approve',exact:true}).click();
 await page.getByText('Owner approval saved',{exact:true}).waitFor();
 await page.getByRole('button',{name:'External audit',exact:true}).click();
 await dialog.getByLabel('Audit findings and source links').fill('Reassess tenant demand. '.repeat(1000));
 await dialog.getByRole('button',{name:'Apply and save revision'}).click();
 await page.getByText('Revised pitch about future leasing.',{exact:true}).waitFor();
 assert.equal(records.get(id).value.decisions.a,undefined);assert.equal(records.get(id).value.owner_revisions.a.length,1);
 await page.getByRole('button',{name:'Reject',exact:true}).click();await dialog.getByLabel('Reason for rejection').fill('Hold for reporting');
 page.once('dialog',d=>d.dismiss());await dialog.getByRole('button',{name:'Cancel'}).click();assert.ok(await dialog.isVisible());
 await dialog.getByRole('button',{name:'Save rejection'}).click();await page.getByText('Rejection saved',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Sent (0)',exact:true}).click();await page.getByText('No items in this view.').waitFor();
 console.log('Mobile owner review passed at 390 × 844 with real HTTP, session, editing, audit and persistence.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(e=>{console.error(e);process.exitCode=1});

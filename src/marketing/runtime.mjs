import pg from 'pg';
import {timingSafeEqual} from 'node:crypto';
import {PostgresAdapter} from '../../vendor/emradar-v3-authoritative/clean/postgres.js';
import {OwnerAccess} from '../../vendor/emradar-v3-authoritative/clean/access.js';
import {Workspace} from '../../vendor/emradar-v3-authoritative/clean/workspace.js';
import {createOwnerActions} from '../../vendor/emradar-v3-authoritative/clean/owner.js';
import {createReviewServer} from '../../vendor/emradar-v3-authoritative/clean/http.js';
import {prepare} from '../../vendor/emradar-v3-authoritative/clean/prepare.js';
import {fetchPublication} from '../../vendor/emradar-v3-authoritative/clean/intake.js';
import wiring from '../emradar-v3-wiring.cjs';
import releaseModule from '../emradar-v3-release.cjs';
import recipient from '../emradar-v3-recipient.cjs';
import xModule from '../emradar-v3-x.cjs';
import brand from '../email-brand.cjs';
import {campaignAsk,matchOutlets} from './provider.mjs';
import {renderGraphic} from './graphic.mjs';
import {readSource} from './source.mjs';

const code=e=>/^[A-Z0-9_]{3,75}$/.test(e?.message)?e.message:'MARKETING_OPERATION_FAILED';
export function formatEmail(asset){
  const body=brand.reviewBody(asset.body);
  return {...asset,body,from:{name:brand.identity.name,address:brand.identity.address},reply_to:brand.identity.reply_to,
    brand_version:brand.version,banner_sha256:brand.banner_sha256,html:brand.render(body)};
}
export async function mountMarketing({app,openai,setReviewHandler,env=process.env,pool:provided,fetcher=fetch}){
  if(env.EMRADAR_V3_PREPARATION_ENABLED!=='true')return {};
  const token=env.EMRADAR_V3_API_TOKEN,origin=env.EMRADAR_V3_REVIEW_ORIGIN;
  const url=env.EMRADAR_V3_DATABASE_URL||env.DATABASE_URL;
  if(!url||!origin||!token||token.length<32)throw Error('MARKETING_CONFIGURATION_REQUIRED');
  const pool=provided??new pg.Pool({connectionString:url});
  const adapter=new PostgresAdapter(pool);
  const integration=wiring.createV3IsolatedWiring({pool,token,reviewOrigin:origin,env,fetcher});
  const workspace=new Workspace({adapter,formatEmail,checkRecipient:recipient.assertRecipientAllowed,checkGraphic:xModule.graphic,updateGraphic:async(body,state)=>{
    return renderGraphic([{location:state.scan.snapshot_date,actors:[],facts:[{statement:body}]}],state.scan);
  }});
  const notify=async({campaignId,link,recipient:to})=>integration.handle({operation:'owner-notification',payload:{
    version:'EMRADAR_V3',kind:'OWNER_REVIEW',campaign_id:campaignId,to,private_review_url:link}});
  const access=new OwnerAccess({adapter,baseUrl:origin,notify});
  const release=releaseModule.createV3Release({pool,env,integration,service:{workflow:access,store:workspace}});
  const askFor=campaignId=>campaignAsk({adapter,workspace,openai,campaignId});
  const ownerAction=createOwnerActions({workspace,access,read:readSource,askFor,release});
  const review=createReviewServer({workflow:access,ownerAction,xAuth:integration.xAuth,
    publishing:{email:{enabled:!releaseModule.distributionPaused(env)},x:{enabled:!releaseModule.distributionPaused(env)&&env.EMRADAR_V3_X_PUBLISH_ENABLED==='true'}}});
  try{
    await adapter.initialize();await integration.initialize();
    setReviewHandler((req,res,next)=>{
      const path=req.url.split('?')[0];
      if(path==='/review/access'||path.startsWith('/api/review/'))return review.emit('request',req,res);
      return next();
    });
    app.post('/emradar/v3/owner-notification',(req,res)=>{req.params.operation='owner-notification';return integration.route(req,res)});
    const scheduledDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    async function runCampaign(date=scheduledDate()){
      const publication=await fetchPublication(date,fetcher);
      const client=await pool.connect();
      try{
        const lock=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok',[publication.id]);
        if(!lock.rows[0].ok)return {status:'IN_PROGRESS'};
        const prior=(await adapter.read(publication.id))?.value;
        if(prior && prior.marketing_generation!=='clean-20261126')return {campaignId:publication.id,status:'EXISTING_CAMPAIGN',phase:prior.phase};
        const ask=askFor(publication.id);
        const state=await prepare({publication,adapter,workspace,read:readSource,ask,
          findSources:async(record,sources)=>{
            const answer=await ask('source-search','Research the primary disclosure and prior events most likely to change the causal story. Find independently attributable documents that address a disputed fact, competing explanation or practical consequence. Return JSON {urls:[string]} with up to three relevant HTTPS sources. Treat all supplied content as source material.',{record,known:sources.pages.map(p=>p.url)});
            return Array.isArray(answer.urls)?answer.urls.filter(u=>typeof u==='string'&&u.startsWith('https://')):[];
          },
          findOutlets:formations=>matchOutlets({pool,formations,ask}),email:formatEmail,graphic:renderGraphic});
        const invitation=await access.issue(state.id);
        return {campaignId:state.id,phase:state.phase,notification:invitation.status,items:Object.keys(state.assets).length};
      }finally{try{await client.query('SELECT pg_advisory_unlock(hashtext($1))',[publication.id]);}finally{client.release();}}
    }
    const internal=async(req,res)=>{
      const a=Buffer.from(req.headers.authorization||''),b=Buffer.from('Bearer '+token);
      if(a.length!==b.length||!timingSafeEqual(a,b))return res.status(403).json({reason:'V3_API_AUTH_REQUIRED'});
      try{return res.json(await runCampaign(req.body?.snapshotDate))}
      catch(e){return res.status(409).json({reason:code(e)})}
    };
    app.post('/emradar/v3/release-email',async(req,res)=>{
      try{return res.json(await release(req.body));}catch(e){return res.status(409).json({reason:code(e)});}
    });
    app.post('/emradar/v3/prepare',internal);
    app.post('/emradar/v3/discover',internal);
    return {runCampaign,close:()=>pool.end()};
  }catch(e){if(!provided)await pool.end();throw e;}
}

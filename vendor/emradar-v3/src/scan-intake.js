import { createHash } from 'node:crypto';
import { assertScan } from './contracts.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function publicationGatesPass(record){
 return record?.gates?.public_snapshot_verification==='PASS'||
  (record?.publication_state==='PUBLISHED'&&['exact_current_bytes','exact_archive_bytes','archive_index','dashboard_render','exact_commit_deployment'].every(key=>record?.gates?.[key]==='PASS'));
}
export function publicationRecordValid(record,{snapshotDate,expectedSha256,archiveUrl,releaseAttestation}){
 if(record?.snapshot_date!==snapshotDate||record?.publication_state!=='PUBLISHED'||
    record?.downstream_release_allowed!==true||!publicationGatesPass(record))return false;
 const legacy=record.public_verification?.verification_contract==='live-reader-exact-identity-v2'&&
  record.public_verification?.artifact_sha256===expectedSha256&&
  record.public_verification?.archive_data_url===archiveUrl;
 const fiveGate=record.source_sha256===expectedSha256&&
  record.source_path===`data/checkpoints/discovery-${snapshotDate}.json`&&
  record.public_reader==='https://emerging-markets-radar.onrender.com'&&
  record.render_deployment_status==='LIVE'&&
  ['exact_current_bytes','exact_archive_bytes','archive_index','dashboard_render','exact_commit_deployment'].every(key=>record.gates?.[key]==='PASS')&&
  /^[a-f0-9]{40}$/.test(record.source_blob_sha||'')&&
  record.source_blob_sha===releaseAttestation?.source_blob_sha;
 // A partial legacy identity cannot be silently treated as the newer format.
 if(record.public_verification&&!legacy)return false;
 if(!legacy&&!fiveGate)return false;
 if(record.source_sha256&&record.source_sha256!==expectedSha256)return false;
 if(record.source_path&&record.source_path!==`data/checkpoints/discovery-${snapshotDate}.json`)return false;
 if(record.source_blob_sha&&releaseAttestation?.source_blob_sha&&record.source_blob_sha!==releaseAttestation.source_blob_sha)return false;
 return true;
}
export function releaseAttestationValid(record,{snapshotDate,expectedSha256,modern=false}){
 if(record?.snapshot_date!==snapshotDate||record?.source_sha256!==expectedSha256||
    record?.source_path!==`data/checkpoints/discovery-${snapshotDate}.json`||
    record?.publication_state!=='PUBLISHED'||record?.downstream_release_allowed!==true||
    record?.native_gates?.publication!=='PASS'||record?.attested_by!=='AUTHORIZED_SOURCE_RELEASE_REVIEW'||
    record?.campaign_authority?.required_stop!=='PUBLICATION_REVIEW'||
    record?.campaign_authority?.external_publication_allowed!==false)return false;
 if(record.campaign_authority.campaign_id&&record.campaign_authority.campaign_id!==`EMRADAR_${snapshotDate.replaceAll('-','_')}_LAUNCH`)return false;
 if(modern&&(!record.campaign_authority.campaign_id||
   !['evidence','editorial','brand','risk','publication'].every(key=>record.native_gates?.[key]==='PASS')))return false;
 return true;
}
export async function verifyPublishedScan({snapshotDate,expectedSha256,liveUrl,archiveUrl,publicationRecord,releaseAttestation,fetcher=fetch}) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate||'') || !/^[a-f0-9]{64}$/.test(expectedSha256||'')) throw Error('INVALID_SCAN_IDENTITY');
 // A signed immutable release remains verifiable after live discovery advances.
 const historical=publicationRecord!==undefined||releaseAttestation!==undefined;
 if(historical||releaseAttestation!==undefined){
  const a=releaseAttestation;
  if(!releaseAttestationValid(a,{snapshotDate,expectedSha256,modern:Boolean(publicationRecord&&!publicationRecord.public_verification)}))
   throw Error('UNTRUSTED_HISTORICAL_RELEASE');
  const p=publicationRecord;
  if(publicationRecord!==undefined&&!publicationRecordValid(p,{snapshotDate,expectedSha256,archiveUrl,releaseAttestation}))
   throw Error('UNTRUSTED_HISTORICAL_RELEASE');
  if(archiveUrl!==`https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-${snapshotDate}.json`)throw Error('INVALID_HISTORICAL_ARCHIVE');
  if(!historical&&liveUrl!=='https://emerging-markets-radar.onrender.com/data/discovery.json')throw Error('UNTRUSTED_SCAN_HOST');
 }
 for(const u of historical?[archiveUrl]:[liveUrl,archiveUrl]) {
  const parsed=new URL(u);
  if(parsed.protocol!=='https:' || parsed.hostname!=='emerging-markets-radar.onrender.com') throw Error('UNTRUSTED_SCAN_HOST');
 }
 const read=async url=>{
  const response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/json'}});
  if(!response.ok) throw Error('SCAN_HTTP_'+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>10*1024*1024) throw Error('SCAN_TOO_LARGE');
  return {bytes,sha256:digest(bytes)};
 };
 const [live,archive]=historical?[null,await read(archiveUrl)]:await Promise.all([read(liveUrl),read(archiveUrl)]);
 const scan=assertScan({snapshot_date:snapshotDate,artifact_sha256:expectedSha256,live_artifact_sha256:historical?archive.sha256:live.sha256,archive_artifact_sha256:archive.sha256,publication_verified:true});
 const document=JSON.parse((historical?archive:live).bytes.toString('utf8'));
 if(historical&&(document.snapshot_date!==snapshotDate||document.publication_state!=='PUBLISHED'))throw Error('PUBLICATION_ARCHIVE_IDENTITY_INVALID');
 return {scan:{...scan,live_artifact_sha256:historical?archive.sha256:live.sha256,archive_artifact_sha256:archive.sha256,publication_verified:true},document};
}

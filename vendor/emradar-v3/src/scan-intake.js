import { createHash } from 'node:crypto';
import { assertScan } from './contracts.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyPublishedScan({snapshotDate,expectedSha256,liveUrl,archiveUrl,publicationRecord,releaseAttestation,fetcher=fetch}) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate||'') || !/^[a-f0-9]{64}$/.test(expectedSha256||'')) throw Error('INVALID_SCAN_IDENTITY');
 const historical=publicationRecord!==undefined || releaseAttestation!==undefined;
 if(historical){
  const p=publicationRecord, a=releaseAttestation;
  if(p?.snapshot_date!==snapshotDate || p?.public_verification?.artifact_sha256!==expectedSha256 || p?.public_verification?.verification_contract!=='live-reader-exact-identity-v2' || p?.gates?.public_snapshot_verification!=='PASS' || p?.downstream_release_allowed!==true || a?.snapshot_date!==snapshotDate || a?.source_sha256!==expectedSha256 || a?.publication_state!=='PUBLISHED' || a?.downstream_release_allowed!==true || a?.native_gates?.publication!=='PASS' || a?.attested_by!=='AUTHORIZED_SOURCE_RELEASE_REVIEW' || a?.campaign_authority?.required_stop!=='PUBLICATION_REVIEW' || a?.campaign_authority?.external_publication_allowed!==false || a?.source_path!==`data/checkpoints/discovery-${snapshotDate}.json` || p?.public_verification?.archive_data_url!==archiveUrl) throw Error('UNTRUSTED_HISTORICAL_RELEASE');
  if(archiveUrl!==`https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-${snapshotDate}.json`) throw Error('INVALID_HISTORICAL_ARCHIVE');
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
 return {scan:{...scan,live_artifact_sha256:historical?archive.sha256:live.sha256,archive_artifact_sha256:archive.sha256,publication_verified:true},document:JSON.parse((historical?archive:live).bytes.toString('utf8'))};
}

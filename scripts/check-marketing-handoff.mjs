// Read-only cutover probe. No request addresses a preparation, approval or release endpoint.
import {createHash} from 'node:crypto';
import {fetchPublication,scannerOrigin} from '../vendor/emradar-v3-authoritative/clean/intake.js';
const dates=process.argv.slice(2);
async function bytes(path){
  const r=await fetch(scannerOrigin+path,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('SCAN_HTTP_'+r.status);
  return Buffer.from(await r.arrayBuffer());
}
for(const date of dates){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('INVALID_SCAN_DATE');
  const raw=await bytes('/data/checkpoints/discovery-'+date+'.json');
  const publication=JSON.parse(await bytes('/verification/publication-'+date+'.json'));
  const release=JSON.parse(await bytes('/verification/downstream-release-attestation-'+date+'.json'));
  const actual=createHash('sha256').update(raw).digest('hex');
  let status;
  try {status=(await fetchPublication(date)).id;}catch(e){status=e.message;}
  console.log(JSON.stringify({date,archive_sha256:actual,publication_sha256:publication.source_sha256,release_sha256:release.source_sha256,status}));
}

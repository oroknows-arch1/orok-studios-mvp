'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function verifyV3SourceIntegration(){
 const repository='oroknows-arch1/emradar-marketing-engine-v3';
 const source=path.join(root,'vendor','emradar-v3-authoritative');
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
 const commit=git(source,'rev-parse','HEAD');
 const manifest=require('../docs/v3-source-integration.json');
 if(manifest.commit!==commit||manifest.repository!==repository||git(source,'config','--get','remote.origin.url')!=='https://github.com/'+repository+'.git')throw Error('V3_SOURCE_PIN_MISMATCH');
 if(git(source,'status','--porcelain')||fs.existsSync(path.join(root,'vendor/emradar-v3'))||fs.existsSync(path.join(source,'src')))throw Error('V3_SOURCE_ISOLATION_FAILED');
 return {status:'V3_SOURCE_INTEGRATED',repository,commit};
}
module.exports={verifyV3SourceIntegration};
if(require.main===module)console.log(verifyV3SourceIntegration());

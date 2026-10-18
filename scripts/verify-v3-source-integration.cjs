'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'docs', 'v3-source-integration.json');
const allowedRepository = 'oroknows-arch1/emradar-marketing-engine-v3';
const allowedUrl = 'https://github.com/' + allowedRepository + '.git';
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();

function verifyV3SourceIntegration() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema_version !== 1 || manifest.repository !== allowedRepository || manifest.url !== allowedUrl) throw new Error('V3_SOURCE_NOT_AUTHORISED');
  if (!/^[a-f0-9]{40}$/.test(manifest.commit || '')) throw new Error('V3_SOURCE_COMMIT_REQUIRED');
  const source = path.resolve(root, manifest.path);
  const overlay = path.resolve(root, manifest.runtime_overlay);
  if (!source.startsWith(root + path.sep) || !overlay.startsWith(root + path.sep)) throw new Error('V3_SOURCE_PATH_INVALID');
  const modules = fs.readFileSync(path.join(root, '.gitmodules'), 'utf8');
  const submoduleUrls = [...modules.matchAll(/^\s*url = (.+)$/gm)].map(match => match[1].trim());
  if (submoduleUrls.length !== 1 || submoduleUrls[0] !== allowedUrl || !modules.includes('path = ' + manifest.path)) throw new Error('V3_SOURCE_SUBMODULE_INVALID');
  if (git(source, 'rev-parse', 'HEAD') !== manifest.commit) throw new Error('V3_SOURCE_COMMIT_MISMATCH');
  if (git(source, 'config', '--get', 'remote.origin.url') !== allowedUrl) throw new Error('V3_SOURCE_REMOTE_MISMATCH');
  if (git(source, 'status', '--porcelain')) throw new Error('V3_SOURCE_WORKTREE_DIRTY');
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (pkg.name !== 'emradar-marketing-engine-v3' || pkg.type !== 'module') throw new Error('V3_SOURCE_PACKAGE_INVALID');
  const shared = {};
  for (const relative of manifest.exact_shared_files) {
    const sourceFile = path.join(source, relative);
    const overlayFile = path.join(overlay, relative);
    if (!fs.existsSync(sourceFile) || !fs.existsSync(overlayFile)) throw new Error('V3_SHARED_FILE_MISSING:' + relative);
    const sourceSha256 = digest(sourceFile);
    const overlaySha256 = digest(overlayFile);
    if (sourceSha256 !== overlaySha256) throw new Error('V3_SHARED_FILE_DIVERGED:' + relative);
    shared[relative] = sourceSha256;
  }
  const authoritativeStandards={};
  for(const relative of manifest.authoritative_standard_files??[]){
    const sourceFile=path.join(source,relative);
    if(!fs.existsSync(sourceFile))throw new Error('V3_AUTHORITATIVE_STANDARD_MISSING:'+relative);
    authoritativeStandards[relative]=digest(sourceFile);
  }
  for(const relative of ['src/editorial-reference.js','src/graphic-standard.js']){
    const expected=`export * from '../../emradar-v3-authoritative/${relative}';\n`;
    if(fs.readFileSync(path.join(overlay,relative),'utf8')!==expected)throw new Error('V3_AUTHORITATIVE_STANDARD_DIVERGED:'+relative);
  }
  const provider=fs.readFileSync(path.join(overlay,'src/openai-preparation-providers.js'),'utf8');
  if(!provider.includes("from '../../emradar-v3-authoritative/src/graphic-renderer.js'"))throw new Error('V3_AUTHORITATIVE_GRAPHIC_RENDERER_NOT_USED');
  return {status:'V3_SOURCE_INTEGRATED',repository:manifest.repository,commit:manifest.commit,path:manifest.path,runtime_overlay:manifest.runtime_overlay,authorised_submodules:submoduleUrls.length,shared,authoritativeStandards};
}

if (require.main === module) console.log(JSON.stringify(verifyV3SourceIntegration()));
module.exports = {verifyV3SourceIntegration};

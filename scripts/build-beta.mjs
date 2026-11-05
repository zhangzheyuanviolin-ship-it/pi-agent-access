/** Build a candidate only. This receipt NEVER authorizes installation/activation. */
import {spawnSync}from'node:child_process';
import{readFileSync,writeFileSync,existsSync}from'node:fs';
import{resolve,join}from'node:path';
import{fileURLToPath}from'node:url';
import{createHash}from'node:crypto';
import{sourceFingerprint}from'./verify-access-release-gate.mjs';
import{runtimeFingerprint}from'./historical-release-gate.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const env={...process.env,PI_ACCESS_PROFILE:'beta',NEXT_PUBLIC_PI_ACCESS_PROFILE:'beta',PI_WEB_BUILD_DIR:'.next-beta',PI_WEB_DESKTOP_BUILD:'1',CARGO_BUILD_JOBS:'4'};
if(!env.PI_DESKTOP_NODE_BINARY||!existsSync(env.PI_DESKTOP_NODE_BINARY))throw Error('Explicit verified self-contained desktop Node required');
function run(binary,args){const r=spawnSync(binary,args,{cwd:root,env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error('Beta candidate command failed; no installation permitted');}
const before=sourceFingerprint(root);
run(process.execPath,['scripts/prepare-desktop.mjs']);
if(sourceFingerprint(root)!==before)throw Error('Source changed while staging; rebuild the exact current candidate');
run(process.execPath,['node_modules/@tauri-apps/cli/tauri.js','build','--config','src-tauri/tauri.beta.conf.json','--bundles','app','--ci']);
if(sourceFingerprint(root)!==before)throw Error('Source changed while bundling; candidate is not accepted');
const app=join(root,'src-tauri/target/release/bundle/macos/Pi Agent Access 测试版.app');
const server=join(app,'Contents/Resources/resources/server');
const hashes={};
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
for(const [src,dest]of[['desktop/server-launcher.cjs','desktop-server.cjs'],['desktop/distribution-profile.cjs','distribution-profile.cjs'],['desktop/beta-gateway.cjs','beta-gateway.cjs'],['beta-runtime/beta_gateway.py','beta-runtime/beta_gateway.py'],['beta-runtime/model_gateway.py','beta-runtime/model_gateway.py'],['beta-runtime/resource_admission.py','beta-runtime/resource_admission.py'],['local-omni/backend.py','local-omni/backend.py'],['local-omni/live.py','local-omni/live.py'],['local-omni/minicpm_session.py','local-omni/minicpm_session.py']]){
 const expected=hash(join(root,src));if(hash(join(server,dest))!==expected)throw Error('Packaged source drift: '+src);hashes[dest]=expected;
}
run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
const receipt={format:1,distributionProfile:'beta',activationAllowed:false,reason:'Development candidate; full historical and real-model gates are separately mandatory',builtAt:new Date().toISOString(),sourceDirectory:root,sourceDigest:before,actualApp:app,runtimeDirectory:server,runtimeDigest:runtimeFingerprint(server),packagedSourceHashes:hashes};
writeFileSync(join(root,'src-tauri/target/beta-candidate.json'),JSON.stringify(receipt,null,2)+'\n');
console.log('BETA_CANDIDATE_BOUND; installation remains blocked until full acceptance');

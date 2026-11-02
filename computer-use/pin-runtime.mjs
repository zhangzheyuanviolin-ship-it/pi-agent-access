// Personal local pin only. Do not redistribute the proprietary application payload.
import fs from'node:fs';import os from'node:os';import path from'node:path';import crypto from'node:crypto';import{spawnSync}from'node:child_process';
const sourceApp='/Applications/ChatGPT.app';
const sourceLcu=path.join(os.homedir(),'.local/share/lcu/releases/0.12.0-c9fc422530f3');
const base=path.join(os.homedir(),'Library/Application Support/Pi Agent Access/computer-use-runtime');
const run=(command,args)=>{const r=spawnSync(command,args,{encoding:'utf8',timeout:120000});if(r.status!==0)throw Error(command+' failed: '+(r.stderr||r.stdout));return r.stdout;};
const check=app=>{run('/usr/bin/codesign',['--verify','--deep','--strict',app]);const r=spawnSync('/usr/bin/codesign',['-dv','--verbose=4',app],{encoding:'utf8'});if(r.status!==0||!r.stderr.includes('TeamIdentifier=2DC432GLL2'))throw Error('Unexpected runtime signer');};
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
check(sourceApp);fs.mkdirSync(base,{recursive:true,mode:0o700});
const version=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(sourceApp,'Contents/Info.plist')]).trim();
if(!/^[0-9.]+$/.test(version))throw Error('Invalid app version');
const slot=path.join(base,version),app=path.join(slot,'ChatGPT.app'),lcu=path.join(slot,'lcu');
fs.mkdirSync(slot,{recursive:true,mode:0o700});
if(!fs.existsSync(app)){
 const stage=path.join(slot,'ChatGPT.staging.app');if(fs.existsSync(stage))throw Error('Inspect unfinished staging before retry');
 run('/bin/cp',['-cR',sourceApp,stage]);check(stage);fs.renameSync(stage,app);
}
check(app);
if(!fs.existsSync(lcu))run('/bin/cp',['-cR',sourceLcu,lcu]);
const selected=path.join(lcu,'app');if(fs.lstatSync(selected).isSymbolicLink())fs.unlinkSync(selected);else throw Error('Expected LCU app symlink');fs.symlinkSync(app,selected);
const descriptor=JSON.parse(fs.readFileSync(path.join(lcu,'installation.json'),'utf8'));descriptor.app=app;fs.writeFileSync(path.join(lcu,'installation.json'),JSON.stringify(descriptor,null,2));
const node=path.join(app,'Contents/Resources/cua_node/bin/node');fs.writeFileSync(path.join(lcu,'node-path'),node+'\n');
const receipt={format:1,createdAt:new Date().toISOString(),sourceApp,app,version,lcu,node,nodeSha256:hash(node),nodeReplSha256:hash(path.join(path.dirname(node),'node_repl')),appInfoSha256:hash(path.join(app,'Contents/Info.plist')),lcuBundleSha256:hash(path.join(lcu,'bundle.json')),copyMethod:'APFS clone; signature unchanged',scope:'local personal runtime pin; no account or credential copied'};
fs.writeFileSync(path.join(base,'runtime-pin.json'),JSON.stringify(receipt,null,2),{mode:0o600});
console.log(JSON.stringify(receipt,null,2));

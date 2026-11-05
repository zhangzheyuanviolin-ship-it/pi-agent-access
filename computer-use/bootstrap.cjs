"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Node launcher before ESM server initialization. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const VERSION = '1.0.0-lcu-v14';
function root() { return path.join(os.homedir(), process.env.PI_ACCESS_PROFILE==='beta'?'Library/Application Support/Pi Agent Access Beta':'Library/Application Support/Pi Agent Access'); }
function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true,mode:0o700});
  const tmp=file+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file);
}
function initializeProfile(agentDir, extension) {
  fs.mkdirSync(agentDir,{recursive:true,mode:0o700});
  const file=path.join(agentDir,'settings.json');
  const settings=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  if(!settings || typeof settings!=='object' || Array.isArray(settings))throw Error('Invalid settings; existing data preserved');
  if(settings.extensions!==undefined&&!Array.isArray(settings.extensions))throw Error('Invalid extension settings; existing data preserved');
  if(!(settings.extensions||[]).includes(extension)){settings.extensions=[...(settings.extensions||[]),extension];write(file,settings);}
}
function prepare({enable=false, dataRoot=root(), distribution=__dirname, applicationPath='/Applications/ChatGPT.app', agentDir=process.env.PI_CODING_AGENT_DIR||path.join(dataRoot,'agent')}={}) {
  fs.mkdirSync(dataRoot,{recursive:true,mode:0o700});
  process.env.PI_CODING_AGENT_DIR=agentDir;
  const statusFile=path.join(dataRoot,'computer-use-status.json');
  const templates=path.join(distribution,'templates');
  const vendor=path.join(distribution,'lcu');
  const prefix=path.join(dataRoot,'lcu');
  let current=path.join(prefix,'current');
  try {
    const pin=JSON.parse(fs.readFileSync(path.join(dataRoot,'computer-use-runtime/runtime-pin.json'),'utf8'));
    const expectedRoot=path.resolve(dataRoot,'computer-use-runtime')+path.sep;
    if(pin.format===1&&typeof pin.lcu==='string'&&path.resolve(pin.lcu).startsWith(expectedRoot)&&fs.existsSync(path.join(pin.lcu,'installation.json'))&&fs.existsSync(pin.node))current=pin.lcu;
  }catch{}
  if(process.env.PI_ACCESS_PROFILE==='beta'){
    const stableBase=path.join(os.homedir(),'Library/Application Support/Pi Agent Access/computer-use-runtime');
    const pin=JSON.parse(fs.readFileSync(path.join(stableBase,'runtime-pin.json'),'utf8'));
    if(pin.format!==1||!path.resolve(pin.lcu).startsWith(path.resolve(stableBase)+path.sep)||!fs.existsSync(path.join(pin.lcu,'installation.json')))throw Error('Beta requires the verified read-only computer runtime');
    current=pin.lcu;
  }
  const extensionDir=path.join(agentDir,'maintained-extensions/lcu');
  let status={version:VERSION,available:false,automaticAccess:false,message:'请先安装官方 ChatGPT，再点击启用电脑操作。'};
  try {
    if(!fs.existsSync(applicationPath)&&!fs.existsSync(path.join(current,'installation.json'))){write(statusFile,status);return status;}
    if(!fs.existsSync(path.join(current,'installation.json'))){
      const staging=fs.mkdtempSync(path.join(dataRoot,'lcu-bundle-'));
      try {
        fs.cpSync(vendor,staging,{recursive:true,verbatimSymlinks:true});
        const manifest=JSON.parse(fs.readFileSync(path.join(staging,'bundle.json'),'utf8'));
        for(const [name,record] of Object.entries(manifest.files))if(record.type==='symlink'){
          const link=path.join(staging,name);fs.rmSync(link,{force:true});fs.symlinkSync(record.target,link);
        }
        const install=spawnSync(process.execPath,[path.join(staging,'scripts/install.mjs'),'--prefix',prefix,'--existing-app',applicationPath,'--runtime-only','--yes'],{encoding:'utf8',timeout:60000,env:process.env});
        if(install.status!==0)throw Error('LCU 安装未完成，请确认官方 ChatGPT 已正常安装。');
      } finally {fs.rmSync(staging,{recursive:true,force:true});}
    }
    fs.mkdirSync(extensionDir,{recursive:true,mode:0o700});
    const escaped=current.replaceAll('\\','\\\\').replaceAll("'","\\'");
    for(const name of ['index.mjs','adapter.ts','result.mjs','image-frame.mjs','image-metadata.mjs','access-policy.mjs','window-recovery.mjs','runtime-environment.mjs','observation-diff.mjs','browser-observation.mjs','browser-registration.mjs','paged-text.mjs','action-guidance.mjs','browser-runtime.mjs','browser-tab-methods.js.txt','native-runtime.mjs','native-app-methods.js.txt','atomic-code-write.mjs','runtime-overlay.mjs']){
      const source=fs.readFileSync(path.join(templates,name),'utf8').replaceAll('__LCU_ROOT__',escaped);
      const dest=path.join(extensionDir,name);
      if(!fs.existsSync(dest)||fs.readFileSync(dest,'utf8')!==source)fs.writeFileSync(dest,source,{mode:0o600});
    }
    const policyFile=path.join(extensionDir,'access-policy.json');
    if(!fs.existsSync(policyFile))write(policyFile,{version:1,normalComputerAccess:'ask'});
    if(enable){
      write(policyFile,{version:1,normalComputerAccess:'allow',authorization:'User enabled ordinary Computer Use access in Pi Agent Access setup.',honorPiPermissionMode:true});
      const browser=process.env.PI_ACCESS_PROFILE==='beta'?{status:0}:spawnSync(path.join(current,'bin/lcu'),['browser','install'],{encoding:'utf8',timeout:30000,env:process.env});
      if(browser.status!==0)throw Error('桌面操作已准备，浏览器连接安装未完成，可再次点击启用重试。');
    }
    initializeProfile(agentDir,path.join(extensionDir,'index.mjs'));
    status={version:VERSION,available:true,automaticAccess:JSON.parse(fs.readFileSync(policyFile,'utf8')).normalComputerAccess==='allow',message:'电脑操作组件已准备。首次使用请按 macOS 提示授予无障碍和录屏权限；Chrome 还需启用官方扩展。'};
  }catch(error){status.message=error.message;}
  write(statusFile,status);return status;
}
function readStatus(){try{return JSON.parse(fs.readFileSync(path.join(root(),'computer-use-status.json'),'utf8'));}catch{return {available:false,automaticAccess:false,message:'电脑操作组件尚未准备。'};}}
module.exports={prepare,root,initializeProfile,readStatus};

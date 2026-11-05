'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
/** One gateway owned by this desktop sidecar. Never attach to, or kill, a listener. */
function startBetaGateway(profile,{serverRoot=__dirname,env=process.env,spawnProcess=spawn}={}){
 if(!profile.beta)return undefined;
 const privateDir=path.join(profile.dataRoot,'private');
 const configPath=path.join(privateDir,'launcher.json');
 if(!fs.existsSync(configPath)){
  console.error('[Pi Agent Beta] 独立推理服务尚未配置；稳定版未受影响');return undefined;
 }
 const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
 if(typeof config.python!=='string'||!path.isAbsolute(config.python)||!fs.existsSync(config.python))throw Error('测试版 Python 运行环境不可用');
 const code=path.join(serverRoot,'beta-runtime/beta_gateway.py');
 const log=fs.openSync(path.join(privateDir,'gateway.log'),'a',0o600);
 let child;
 try{child=spawnProcess(config.python,['-B',code],{env:{...env,PI_ACCESS_PROFILE:'beta'},stdio:['ignore',log,log],cwd:serverRoot});}
 finally{fs.closeSync(log);}
 // No process-name based cleanup, global port cleanup, or stable gateway calls.
 const stop=()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
 process.once('exit',stop);
 child.once('error',error=>console.error('[Pi Agent Beta] 独立推理服务启动失败:',error.message));
 child.once('exit',(code,signal)=>{process.removeListener('exit',stop);console.error(`[Pi Agent Beta] 独立推理服务退出 (${signal||code})`);});
 return child;
}
module.exports={startBetaGateway};

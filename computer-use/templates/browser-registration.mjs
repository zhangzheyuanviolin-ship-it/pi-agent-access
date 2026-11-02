import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
/** Repair only the existing, user-authorized Chrome relay. Never change browser/OS permissions. */
export function createBrowserRegistrationRecovery({lcuRoot,extensionDir,home=homedir(),platform=process.platform,install=async()=>run(join(lcuRoot,'bin/lcu'),['browser','install'],{timeout:30000,maxBuffer:65536})}){
 let pending;
 return async()=>{
  if(platform!=='darwin')return;
  const manifest=join(home,'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openai.codexextension.json');
  try{
   if(JSON.parse(readFileSync(join(extensionDir,'access-policy.json'),'utf8')).normalComputerAccess!=='allow')return;
   if(!lstatSync(manifest).isFile())return '浏览器连接配置不是普通文件，未改动；需要检查。';
   const app=realpathSync(join(lcuRoot,'app'));
   const id=createHash('sha256').update(app).digest('hex').slice(0,16);
   const expected=join(home,'Library/Application Support/lcu/browser',id,'lcu-native-host');
   const record=JSON.parse(readFileSync(manifest,'utf8'));
   if(record.path===expected)return;
   if(!Array.isArray(record.allowed_origins)||!record.allowed_origins.some(x=>x==='chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/'))return '浏览器注册不属于已授权的官方扩展，未自动覆盖。';
   if(!pending)pending=install().finally(()=>{pending=undefined;});
   await pending;
   if(JSON.parse(readFileSync(manifest,'utf8')).path!==expected)throw Error('relay verification failed');
   return '浏览器连接器注册曾被其他应用改写，现已恢复Pi既有连接器。若标签列表仍为空，先读取Chrome界面，打开已有ChatGPT扩展以唤醒连接，然后重新观察；不要重启浏览器、切换权限或重放未核实的动作。';
  }catch(e){if(e?.code==='ENOENT')return;return '浏览器连接器检查未通过：'+String(e.message).slice(0,180)+'。未修改系统网络或权限。';}
 };
}

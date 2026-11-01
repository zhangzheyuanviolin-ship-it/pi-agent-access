import {mkdirSync,writeFileSync,readFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
export type HealthProcess={pid:number;ppid:number;state:string;cpu:number;name:string};
export function parseProcesses(text:string):HealthProcess[]{return text.split('\n').flatMap(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(.+)$/);return m?[{pid:+m[1],ppid:+m[2],state:m[3],cpu:+m[4],name:m[5].split('/').pop()!}]:[]})}
export function processTree(rows:HealthProcess[],pid:number):HealthProcess[]{const found=new Set([pid]);for(let i=0;i<rows.length;i++){let added=false;for(const r of rows)if(found.has(r.ppid)&&!found.has(r.pid)){found.add(r.pid);added=true}if(!added)break}return rows.filter(r=>found.has(r.pid))}
export function healthText(elapsed:number,silent:number,rows:HealthProcess[]):string{
 const seconds=(n:number)=>Math.floor(n/1000)+'秒';const stopped=rows.some(r=>r.state.includes('T'));const cpu=rows.reduce((n,r)=>n+r.cpu,0);const names=[...new Set(rows.map(r=>r.name))].join('、');
 return `命令运行状态：已执行${seconds(elapsed)}；最近${seconds(silent)}没有新输出。`+(stopped?'检测到进程处于暂停状态。':cpu>=1?`进程仍有CPU活动，采样合计${cpu.toFixed(1)}%。`:'当前CPU活动较低；仅凭无输出不能判断卡死，可能在等待网络、磁盘或其他事件。')+(names?`相关进程：${names}。`:'进程采样暂不可用。')+'不会因等待时间长而自动终止；需要中断时请使用停止。';
}
export function beginCommandHealth(env:NodeJS.ProcessEnv,onHealth?:(text:string)=>void){
 const id=randomUUID(),root=join(homedir(),'.pi','agent','command-health');mkdirSync(root,{recursive:true,mode:0o700});const pidFile=join(root,id+'.pid'),file=join(root,id+'.json');writeFileSync(pidFile,'',{mode:0o600});const started=Date.now();let lastOutput=started,outputBytes=0,closed=false,sampling=false;let rows:HealthProcess[]=[];let pid:number|undefined;
 const save=(state:string)=>{const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify({id,sessionId:env.PI_SESSION_ID??null,startedAt:started,observedAt:Date.now(),lastOutputAt:lastOutput,outputBytes,pid,state,processes:rows,interpretation:healthText(Date.now()-started,Date.now()-lastOutput,rows)}),{mode:0o600});renameSync(tmp,file)};save('running');
 const sample=()=>{if(closed||sampling)return;sampling=true;try{const n=Number(readFileSync(pidFile,'utf8'));if(Number.isInteger(n)&&n>1)pid=n}catch{};execFile('/bin/ps',['-axo','pid=,ppid=,state=,%cpu=,comm='],{timeout:2000,maxBuffer:2*1024*1024},(error,stdout)=>{sampling=false;if(closed)return;const all=error?[]:parseProcesses(stdout);const owner=all.find(r=>r.pid===pid);rows=owner?.ppid===process.pid?processTree(all,pid!):[];try { save('running');if(Date.now()-started>=10000)onHealth?.(healthText(Date.now()-started,Date.now()-lastOutput,rows)) } catch { /* advisory only */ }})};const timer=setInterval(sample,10000);timer.unref();
 return {environment:{...env,PI_COMMAND_HEALTH_PID_FILE:pidFile},wrap:(command:string)=>'printf \'%s\' "$$" > "$PI_COMMAND_HEALTH_PID_FILE"\nunset PI_COMMAND_HEALTH_PID_FILE\n'+command,data:(data:Uint8Array)=>{outputBytes+=data.length;lastOutput=Date.now()},finish:(state='finished')=>{if(closed)return;closed=true;clearInterval(timer);try{save(state);unlinkSync(pidFile)}catch{}}};
}

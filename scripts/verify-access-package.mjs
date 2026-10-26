/** Release smoke check with disposable agent data; does not send model requests. */
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const app=resolve(process.argv[2]);
const resources=join(app,'Contents/Resources/resources');
const server=join(resources,'server');
const node=join(resources,'Pi Agent Server.app/Contents/MacOS/node');
const scratch=await realpath(await mkdtemp(join(tmpdir(),'pi-access-smoke-')));
const agent=join(scratch,'agent');const project=join(scratch,'project');
await mkdir(project);const token=randomBytes(24).toString('hex');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`;
const env={...process.env,PI_CODING_AGENT_DIR:agent,PORT:String(port),HOSTNAME:'127.0.0.1',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',PI_DESKTOP_API_TOKEN:token};
delete env.__NEXT_PRIVATE_STANDALONE_CONFIG;delete env.__NEXT_PRIVATE_ORIGIN;
const entry=`const b=require('./access-distribution/bootstrap.cjs');const s=b.prepare({dataRoot:${JSON.stringify(scratch)},agentDir:${JSON.stringify(agent)}});if(!s.available)throw Error(s.message);require('./server.js');`;
const child=spawn(node,['-e',entry],{cwd:server,env,stdio:['ignore','pipe','pipe']});
let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',v=>logs+=v);
try{
 let ready=false;
 for(let i=0;i<120;i++){
  if(child.exitCode!==null)throw Error('Server exited: '+logs);
  try{if((await fetch(base+'/api/home')).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 assert.ok(ready,'server ready');
 const setup=await fetch(base+'/api/computer-use/setup');assert.equal(setup.status,200);
 const state=await setup.json();assert.equal(typeof state.available,'boolean');
 assert.equal((await fetch(base+'/api/computer-use/setup',{method:'POST',headers:{'content-type':'application/json'},body:'{"enable":true}'})).status,403);
 assert.equal((await fetch(base+'/api/computer-use/setup',{method:'POST',headers:{'content-type':'application/json','x-pi-desktop-token':token},body:'{"enable":false}'})).status,400);
 const created=await fetch(base+'/api/agent/new',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cwd:project,type:'ensure_session'})});
 const session=await created.json();assert.equal(created.status,200,JSON.stringify(session));assert.equal(session.success,true);
 const runtime=await fetch(base+'/api/agent/'+encodeURIComponent(session.sessionId));assert.equal(runtime.status,200);
 const settings=JSON.parse(await readFile(join(agent,'settings.json'),'utf8'));assert.equal(settings.extensions.length,1);
 assert.ok(settings.extensions[0].startsWith(agent));
 assert.doesNotMatch(logs,/Cannot find module|ERR_MODULE_NOT_FOUND|Failed to load extension/i);
 console.log(JSON.stringify({passed:true,setupStatus:200,unauthorizedSetup:403,explicitEnableRequired:400,agentCreated:true,managedExtensionInstalled:true,privateProfile:true}));
}finally{
 child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r);setTimeout(r,3000).unref();});
 await rm(scratch,{recursive:true,force:true});
}

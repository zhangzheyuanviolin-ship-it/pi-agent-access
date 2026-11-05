import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createJiti} from 'jiti';
import {createHash} from 'node:crypto';
import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent';
const root=await mkdtemp(join(tmpdir(),'pi-prefix-wire-'));process.env.PI_CODING_AGENT_DIR=join(root,'agent');await mkdir(process.env.PI_CODING_AGENT_DIR);
test.after(()=>rm(root,{recursive:true,force:true}));
const {createLocalPrefixObserver}=await createJiti(import.meta.url,{moduleCache:false}).import('./local-prefix-observer.ts');
async function setup(t){
 let calls=0,change='none';
 const server=createServer(async(req,res)=>{for await(const _ of req){}calls++;res.writeHead(200,{'Content-Type':'text/event-stream'});for(const choice of [{delta:{role:'assistant',content:'ok'},finish_reason:null},{delta:{},finish_reason:'stop'}])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,...choice}]})+'\n\n');res.end('data: [DONE]\n\n');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const dir=await mkdtemp(join(root,'case-'));const modelsPath=join(dir,'models.json');
 await writeFile(modelsPath,JSON.stringify({providers:{'mac-local-unified':{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'fixture-not-a-secret',models:[{id:'fixture',name:'Fixture',contextWindow:8192,maxTokens:32,input:['text'],reasoning:false}]}}}));
 const runtime=await ModelRuntime.create({modelsPath,authPath:join(dir,'auth.json'),refreshOnCreate:false});const manager=SessionManager.inMemory(dir);
 const loader=new DefaultResourceLoader({cwd:dir,agentDir:dir,settingsManager:SettingsManager.inMemory({}),noSkills:true,noExtensions:true,noContextFiles:true,noThemes:true,noPromptTemplates:true,extensionFactories:[{name:'fixture-churn',factory:pi=>pi.on('before_provider_request',e=>{
  const body=structuredClone(e.payload);body.tools=[{type:'function',function:{name:'fixture',description:change==='tools'?'changed':'original',parameters:{type:'object',properties:{}}}}];
  if(change==='system')body.messages=[{role:'system',content:'unexpected change'},...body.messages];return body;
 })},createLocalPrefixObserver(manager.getSessionId())]});await loader.reload();
 const {session}=await createAgentSession({cwd:dir,agentDir:dir,modelRuntime:runtime,model:runtime.getModel('mac-local-unified','fixture'),resourceLoader:loader,sessionManager:manager,settingsManager:SettingsManager.inMemory({})});t.after(()=>session.dispose());
 return {session,manager,calls:()=>calls,change:value=>{change=value;}};
}
for(const kind of ['tools','system'])test(`unexpected ${kind} mutation is recorded without blocking HTTP or the next turn`,async t=>{
 const s=await setup(t);await s.session.prompt('first');assert.equal(s.calls(),1);
 s.change(kind);await s.session.prompt('second');assert.equal(s.calls(),2,'Observer interrupted the request');assert.equal(s.session.isStreaming,false);
 await s.session.prompt('retry');assert.equal(s.calls(),3,'Observer interrupted continuation');
 s.change('none');await s.session.prompt('restored');assert.equal(s.calls(),4);
});
test('a user-applied capability epoch permits an intentional configuration change',async t=>{
 const s=await setup(t);await s.session.prompt('first');s.change('tools');s.manager.appendCustomEntry('pi-web:context-capabilities-v1',{createdAt:'user-applied-new-policy'});await s.session.prompt('explicit changed configuration');assert.equal(s.calls(),2);
});
test('a damaged diagnostic baseline never interrupts the current or following request',async t=>{
 const s=await setup(t);await s.session.prompt('first');
 const key=createHash('sha256').update(JSON.stringify(s.manager.getSessionId())).digest('hex');
 await writeFile(join(process.env.PI_CODING_AGENT_DIR,'pi-web-context',key+'-prefix-observer.json'),'{damaged fixture');
 await s.session.prompt('second');await s.session.prompt('third');assert.equal(s.calls(),3);assert.equal(s.session.isStreaming,false);
});

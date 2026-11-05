import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createJiti} from 'jiti';
import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent';
import {fauxProvider,fauxAssistantMessage,fauxText,fauxToolCall} from '@earendil-works/pi-ai';
const jiti=createJiti(import.meta.url,{moduleCache:false});
const {createPiWebBuiltinExtensions}=await jiti.import('./builtin-extensions.ts');
const {AgentSessionWrapper}=await jiti.import('./rpc-manager.ts');
const {createCapabilityTools}=await jiti.import('./context-capabilities/runtime.ts');
const {defaultPolicy}=await jiti.import('./context-capabilities/policy.ts');
const {createManagedSystemPromptExtension}=await jiti.import('./exact-system-prompt.ts');
const fixture=fileURLToPath(new URL('./__fixtures__/mcp-env-server.mjs',import.meta.url));
const server=exposure=>({command:process.execPath,args:[fixture],exposure,description:'Fixed fixture server'});
async function until(fn){for(let i=0;i<500;i++){if(fn())return;await delay(10);}throw Error('Timed out');}

async function harness(t,name,exposure){
 const dir=await mkdtemp(join(tmpdir(),'pi-stable-discovery-'));const agentDir=join(dir,'agent');await mkdir(agentDir);
 const config=servers=>writeFile(join(agentDir,'mcp.json'),JSON.stringify({mcpServers:servers}));await config({[name]:server(exposure)});
 const p=defaultPolicy();for(const k in p.enabled)p.enabled[k]=k==='mcp';const record={policy:p,prompt:'Stable fixture prompt',components:[],createdAt:'fixture'};
 const faux=fauxProvider({models:[{id:'fixture'}]});const runtime=await ModelRuntime.create({modelsPath:null,authPath:join(dir,'auth.json'),refreshOnCreate:false});runtime.registerNativeProvider(faux.provider);
 const seen=[];let latest;
 async function open(manager){
  const builtins=await createPiWebBuiltinExtensions({agentDir,stableToolPrefix:true,mcpHost:{idleMs:40,promptWaitMs:5000}});
  const loader=new DefaultResourceLoader({cwd:dir,agentDir,settingsManager:SettingsManager.inMemory({}),noExtensions:true,additionalExtensionPaths:['builtin:mcp','builtin:codemode','builtin:tool-search'],noSkills:true,noContextFiles:true,noThemes:true,noPromptTemplates:true,extensionFactories:[...builtins.extensions,createCapabilityTools(record,dir,()=>[]),createManagedSystemPromptExtension(()=>record.prompt,s=>record.pluginPrompt??(record.pluginPrompt=s))]});await loader.reload();
  const {session}=await createAgentSession({cwd:dir,agentDir,model:faux.getModel('fixture'),modelRuntime:runtime,sessionManager:manager,resourceLoader:loader,settingsManager:SettingsManager.inMemory({})});
  latest=new AgentSessionWrapper(session,{mcpHost:builtins.mcpHost});latest.beginExtensionBinding();await latest.waitUntilReady();return {session,wrapper:latest,host:builtins.mcpHost};
 }
 t.after(async()=>{latest?.destroy();await delay(50);await rm(dir,{recursive:true,force:true});});
 let current=await open(SessionManager.create(dir,join(dir,'sessions')));
 const capture=reply=>ctx=>{seen.push(structuredClone(ctx.messages));return reply;};
 const plain=text=>capture(fauxAssistantMessage([fauxText(text)]));
 const call=(name,args)=>capture(fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:'toolUse'}));
 async function send(responses,text='fixture task'){faux.setResponses(responses);await current.wrapper.send({type:'prompt',message:text});await until(()=>!current.wrapper.isRunning());}
 const effectiveTools=messages=>{const tools=new Map();for(const m of messages)if(m.role==='system'){for(const t of m.toolsRemoved??[])tools.delete(t.name);for(const t of m.toolsAdded??[])tools.set(t.name,t);}return [...tools.values()];};
 await send([plain('ready')]);const baseline=structuredClone(seen[0][0]);const baselineTools=effectiveTools(seen[0]);
 assert.ok(!JSON.stringify(baseline.toolsAdded).includes('mcp__'+name+'__'));
 await until(()=>current.host.serverStates().length===0);
 await send([call('mcp_discover',{enable:[`mcp__${name}__env_has`]}),call('mcp_call',{name:`mcp__${name}__env_has`,arguments:{name:'LANG'}}),call('tool_search',{query:'env_has'}),call('tool_search',{call:{name:`mcp__${name}__env_has`,arguments:{name:'LANG'}}}),plain('done')]);
 const results=current.session.messages.filter(m=>m.role==='toolResult');assert.ok(results.length>=4);
 assert.ok(results.every(r=>!r.isError),JSON.stringify(results));
 const file=current.session.sessionManager.getSessionFile();current.wrapper.destroy();await delay(60);
 current=await open(SessionManager.open(file));await send([plain('after restart')],'new instruction');
 for(const messages of seen){assert.deepEqual(messages[0],baseline,`Leading prefix changed for ${name}/${exposure}`);assert.deepEqual(effectiveTools(messages),baselineTools,`Effective provider tool prefix changed for ${name}/${exposure}`);}
 // Registration of an additional server and a tool call remain possible without promotion.
 await config({[name]:server(exposure),additional:server('deferred')});
 await send([call('tool_search',{call:{name:'mcp__additional__record',arguments:{note:'fixture'}}}),plain('additional complete')]);
 assert.equal(current.session.messages.filter(m=>m.role==='toolResult').at(-1).isError,false);
 assert.deepEqual(seen.at(-1)[0],baseline);
 return seen.length;
}
for(const name of ['minis_excel','minis_word','minis_office','minis_media_context','minis_context7','minis_remotion']){
 for(const exposure of ['codemode','deferred','direct']){
  test(`${name}/${exposure}: discovery, call, idle reconnect, process reload and added server preserve prefix`,async t=>{await harness(t,name,exposure);});
 }
}

// Isolated real MiniCPM HTTP/SDK test. No production settings or user sessions.
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import assert from 'node:assert/strict';
import {createJiti} from 'jiti';import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent';
const output=process.env.OMNI_TEST_OUTPUT;if(!output)throw Error('Explicit evidence directory required');
const root=await mkdtemp(join(tmpdir(),'pi-omni-main-'));process.env.PI_CODING_AGENT_DIR=root;await mkdir(join(root,'pi-web-context'));
const jiti=createJiti(import.meta.url,{moduleCache:false});const {createLocalOmniExtension}=await jiti.import('../lib/local-omni.ts');const {attachmentNotice,RECEIVED_ATTACHMENT}=await jiti.import('../lib/received-attachments.ts');
const settings={enabled:true,outputDirectory:join(output,'audio-output'),models:{minicpm:{enabled:true}}};await writeFile(join(root,'pi-web-context/local-omni.json'),JSON.stringify(settings));
const id='MiniCPM-o-4.5-F16';const modelsPath=join(root,'models.json');await writeFile(modelsPath,JSON.stringify({providers:{'mac-local-unified':{baseUrl:'http://127.0.0.1:12353/v1',api:'openai-completions',apiKey:'local-test',models:[{id,name:id,contextWindow:32768,maxTokens:256,input:['text','image'],reasoning:false,compat:{supportsDeveloperRole:false,supportsUsageInStreaming:true}}]}}}));
const runtime=await ModelRuntime.create({modelsPath,authPath:join(root,'auth.json'),refreshOnCreate:false});const manager=SessionManager.inMemory(root);const wire=[];
const loader=new DefaultResourceLoader({cwd:root,agentDir:root,settingsManager:SettingsManager.inMemory({}),noExtensions:true,noSkills:true,noContextFiles:true,noThemes:true,noPromptTemplates:true,systemPrompt:'You are a helpful assistant.',extensionFactories:[createLocalOmniExtension(),{name:'wire-evidence',factory:pi=>pi.on('before_provider_request',e=>{const b=e.payload;wire.push({tools:b.tools,messages:b.messages.map(m=>({...m,content:Array.isArray(m.content)?m.content.map(c=>c.type==='text'?c:{type:c.type,bytes:JSON.stringify(c).length}):m.content}))});})}]});await loader.reload();
const {session}=await createAgentSession({cwd:root,agentDir:root,resourceLoader:loader,modelRuntime:runtime,model:runtime.getModel('mac-local-unified',id),sessionManager:manager,settingsManager:SettingsManager.inMemory({autoCompactionEnabled:false,autoRetryEnabled:false})});await session.bindExtensions({});
const results=[];
try{
 const path='/Users/zhangzheyuan/LocalAI/Omni-Acceptance-20261104/fixtures/speech.wav';const data=await readFile(path);const file={id:'own-fixture',path,name:'speech.wav',size:data.length};manager.appendCustomEntry(RECEIVED_ATTACHMENT,file);
 for(const prompt of ['Transcribe the recording exactly.'+attachmentNotice([file]),'What day and time was the meeting? Reply briefly.']){
  await session.prompt(prompt);const msg=session.messages.filter(m=>m.role==='assistant').at(-1);results.push(msg);assert.notEqual(msg.stopReason,'error',msg.errorMessage);console.log(JSON.stringify(msg));
 }
 assert.equal(wire[0].tools,undefined);assert.ok(wire[0].messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='audio_url')));assert.match(JSON.stringify(results[0]),/Friday/i);assert.match(JSON.stringify(results[1]),/Friday/i);
 await writeFile(join(output,'pi-main-acceptance.json'),JSON.stringify({results,wire},null,2));
}finally{await session.dispose();await rm(root,{recursive:true,force:true});}

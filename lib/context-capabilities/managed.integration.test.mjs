import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJiti} from 'jiti';
import {createAgentSession,DefaultResourceLoader,SessionManager,SettingsManager,ModelRuntime} from '@earendil-works/pi-coding-agent';
import {fauxProvider,fauxAssistantMessage,fauxText,fauxToolCall,normalizeContext,getCurrentSystemMessage} from '@earendil-works/pi-ai';
const root=await mkdtemp(join(tmpdir(),'pi-context-v4-'));process.env.PI_CODING_AGENT_DIR=join(root,'agent');await mkdir(process.env.PI_CODING_AGENT_DIR);
const jiti=createJiti(import.meta.url,{moduleCache:false});
const {defaultPolicy,allowedTool,parsePolicy,selectCapabilityTools}=await jiti.import('./policy.ts');
const {buildPolicyRecord,createCapabilityTools}=await jiti.import('./runtime.ts');
const {createManagedSystemPromptExtension}=await jiti.import('../exact-system-prompt.ts');
const {saveMemory,listMemory,searchMemory}=await jiti.import('./memory.ts');
test.after(()=>rm(root,{recursive:true,force:true}));
function none(){const p=defaultPolicy();for(const k in p.enabled)p.enabled[k]=false;return p;}
async function start(t,p,skills=[]){const cwd=join(root,crypto.randomUUID());await mkdir(cwd);await writeFile(join(cwd,'AGENTS.md'),'DO_NOT_LEAK_PROJECT');const record=await buildPolicyRecord(cwd,p);const faux=fauxProvider({models:[{id:'context-test'}]});const runtime=await ModelRuntime.create({authPath:join(root,'auth.json'),modelsPath:null,refreshOnCreate:false});runtime.registerNativeProvider(faux.provider);const loader=new DefaultResourceLoader({cwd,agentDir:process.env.PI_CODING_AGENT_DIR,settingsManager:SettingsManager.inMemory({}),noExtensions:true,noSkills:true,noContextFiles:true,noThemes:true,noPromptTemplates:true,systemPrompt:' ',appendSystemPrompt:[' '],extensionFactories:[createCapabilityTools(record,cwd,()=>skills),createManagedSystemPromptExtension(()=>record.prompt,t=>t)]});await loader.reload();const {session}=await createAgentSession({cwd,agentDir:process.env.PI_CODING_AGENT_DIR,resourceLoader:loader,modelRuntime:runtime,model:faux.getModel('context-test'),sessionManager:SessionManager.inMemory(cwd),settingsManager:SettingsManager.inMemory({})});await session.bindExtensions({});t.after(()=>session.dispose());return {session,faux,record,cwd};}
test('all-off sends neither project instructions nor tools, preserving structured projection',async t=>{const {session,faux}=await start(t,none());let seen;faux.setResponses([ctx=>{seen=normalizeContext(ctx);return fauxAssistantMessage([fauxText('ok')]);}]);await session.prompt('你好');assert.equal(getCurrentSystemMessage(seen.messages)?.toolsAdded?.length??0,0);assert.ok(!JSON.stringify(seen).includes('DO_NOT_LEAK_PROJECT'));assert.ok(!JSON.stringify(seen).includes('expert coding assistant'));});
test('memory-only creates and searches Chinese memory without filesystem tools',async t=>{const p=none();p.enabled.memory=true;const {session,faux}=await start(t,p);let seen;faux.setResponses([()=>fauxAssistantMessage([fauxToolCall('memory_write',{title:'中文偏好',text:'喜欢使用小提琴教学材料',kind:'global'},{id:'save'})],{stopReason:'toolUse'}),ctx=>{seen=normalizeContext(ctx);return fauxAssistantMessage([fauxText('已保存')]);}]);await session.prompt('请记住我的偏好');assert.ok(listMemory().some(x=>x.title==='中文偏好'));assert.ok(!(getCurrentSystemMessage(seen.messages)?.toolsAdded??[]).some(t=>['bash','read','edit','write'].includes(t.name)));assert.ok(searchMemory({query:'教学',project:''}).length);assert.ok(searchMemory({query:'音乐',mode:'related',project:''}).length);});
test('skill-only loads enabled instructions without a general file reader',async t=>{const p=none();p.enabled.skills=true;const file=join(root,'fixture-skill.md');await writeFile(file,'Only this skill body');const {session,faux}=await start(t,p,[{name:'example',filePath:file}]);let seen;faux.setResponses([()=>fauxAssistantMessage([fauxToolCall('skill_load',{name:'example'},{id:'load'})],{stopReason:'toolUse'}),ctx=>{seen=normalizeContext(ctx);return fauxAssistantMessage([fauxText('ok')]);}]);await session.prompt('读取技能');assert.ok(JSON.stringify(seen.messages).includes('Only this skill body'));assert.ok(!(getCurrentSystemMessage(seen.messages)?.toolsAdded??[]).some(t=>t.name==='read'||t.name==='bash'));});
test('stable second turn does not replace the leading system content',async t=>{const p=none();p.enabled.system=true;const {session,faux}=await start(t,p);const seen=[];faux.setResponses([ctx=>{seen.push(ctx.messages);return fauxAssistantMessage([fauxText('one')]);},ctx=>{seen.push(ctx.messages);return fauxAssistantMessage([fauxText('two')]);}]);await session.prompt('first');await session.prompt('second');assert.deepEqual(seen[1].slice(0,seen[0].length),seen[0]);});
test('disabled and unapproved plugin tools cannot pass the call gate',()=>{const p=none();p.enabled.plugins=true;p.plugins=['/allowed/plugin.ts'];assert.equal(allowedTool('click',p,'/other/plugin.ts'),false);assert.equal(allowedTool('click',p,'/allowed/plugin.ts'),true);assert.equal(allowedTool('mcp__server__write',p,'/allowed/plugin.ts'),false);assert.equal(allowedTool('bash',p,'/allowed/plugin.ts'),false);assert.throws(()=>parsePolicy({}));});
test('memory revisions, date filters, project isolation and recoverable deletion',()=>{const a=saveMemory({kind:'project',project:'/project-a',title:'项目',text:'原始记忆'});assert.equal(searchMemory({query:'原始',project:'/project-b'}).length,0);assert.throws(()=>saveMemory({id:a.id,expectedUpdatedAt:'old',title:'错误',text:'错误'}));const b=saveMemory({id:a.id,expectedUpdatedAt:a.updatedAt,title:'项目',text:'更新记忆'});assert.equal(b.revisions[0].text,'原始记忆');const d=saveMemory({id:b.id,expectedUpdatedAt:b.updatedAt,action:'delete'});assert.equal(searchMemory({query:'更新',project:'/project-a'}).length,0);saveMemory({id:d.id,expectedUpdatedAt:d.updatedAt,action:'restore'});assert.equal(searchMemory({query:'更新',project:'/project-a',from:'2999-01-01'}).length,0);assert.equal(searchMemory({query:'更新',project:'/project-a'}).length,1);});

test('enabled MCP facades precede the first request without promoting deferred targets',()=>{const p=none();p.enabled.memory=true;p.enabled.mcp=true;assert.deepEqual(selectCapabilityTools([{name:'memory_search'},{name:'bash'},{name:'tool_search'},{name:'mcp__server__deferred',exposure:'deferred'}],p,[]),['memory_search','tool_search']);});
test('old active MCP targets stay deferred while fixed facades remain available',()=>{const p=none();p.enabled.mcp=true;const tools=[{name:'codemode'},{name:'tool_search'},{name:'mcp_call'},{name:'mcp_discover'},{name:'mcp__server__read',exposure:'deferred'}];assert.deepEqual(selectCapabilityTools(tools,p,['mcp__server__read']),['codemode','tool_search','mcp_call','mcp_discover']);p.enabled.mcp=false;assert.deepEqual(selectCapabilityTools(tools,p,[]),[]);});

test('received attachment is appended once to a new user turn without changing existing prefix',async t=>{
 const {pendingAttachments,attachmentNotice,RECEIVED_ATTACHMENT,NOTIFIED_ATTACHMENTS}=await jiti.import('../received-attachments.ts');
 const p=none();p.enabled.system=true;const {session,faux}=await start(t,p);const seen=[];
 faux.setResponses([ctx=>{seen.push(structuredClone(ctx.messages));return fauxAssistantMessage([fauxText('ready')]);},ctx=>{seen.push(structuredClone(ctx.messages));return fauxAssistantMessage([fauxText('received')]);},ctx=>{seen.push(structuredClone(ctx.messages));return fauxAssistantMessage([fauxText('next')]);}]);
 await session.prompt('first task');const f={id:'fixture',name:'example.bin',path:'/fixed/session/example.bin',size:100000000};const receipts=[{type:'custom',customType:RECEIVED_ATTACHMENT,data:f}];
 await session.prompt('use my attachment'+attachmentNotice(pendingAttachments(receipts)));receipts.push({type:'custom',customType:NOTIFIED_ATTACHMENTS,data:{ids:[f.id]}});await session.prompt('a new user instruction'+attachmentNotice(pendingAttachments(receipts)));
 assert.deepEqual(seen[1].slice(0,seen[0].length),seen[0]);assert.deepEqual(seen[2].slice(0,seen[1].length),seen[1]);assert.ok(JSON.stringify(seen[1].at(-1)).includes(f.path));assert.ok(!JSON.stringify(seen[2].at(-1)).includes(f.path));
});
test('unsupported video tool stays absent across managed loadout refreshes',()=>{const p=none();p.enabled.files=true;const tools=[{name:'read'},{name:'write'},{name:'video_analyze'}];assert.deepEqual(selectCapabilityTools(tools,p,[]),['read','write']);assert.deepEqual(selectCapabilityTools(tools,p,['read','write'],{video:false}),['read','write']);assert.deepEqual(selectCapabilityTools(tools,p,[],{video:true}),['read','write','video_analyze']);});


test('fresh sessions enable global memory and leave project memory off; saved choices survive',()=>{
 const p=defaultPolicy();assert.equal(p.enabled.memory,true);assert.equal(p.memoryGlobal,true);assert.equal(p.memoryProject,false);
 const saved={...p,enabled:{...p.enabled,memory:false},memoryGlobal:false,memoryProject:true};
 assert.deepEqual(parsePolicy(saved),saved);
});

test('daily memory written in one workspace is searchable and readable in another without exposing project notes',async t=>{
 const p=none();p.enabled.memory=true;
 const writer=await start(t,p);writer.faux.setResponses([
  ()=>fauxAssistantMessage([fauxToolCall('memory_write',{title:'跨会话工作日记',text:'浏览器坐标点击复测，记录模型判断错误的修复',kind:'daily'},{id:'daily-save'})],{stopReason:'toolUse'}),
  ()=>fauxAssistantMessage([fauxText('saved')])]);
 await writer.session.prompt('保存今日工作');
 const daily=listMemory().find(x=>x.title==='跨会话工作日记');assert.ok(daily);
 saveMemory({kind:'project',project:writer.cwd,title:'项目私有',text:'private project sentinel'});
 const reader=await start(t,p);const observed=[];reader.faux.setResponses([
  ()=>fauxAssistantMessage([fauxToolCall('memory_search',{query:'工作',mode:'related'},{id:'find'})],{stopReason:'toolUse'}),
  ctx=>{observed.push(JSON.stringify(normalizeContext(ctx)));return fauxAssistantMessage([fauxToolCall('memory_read',{id:daily.id},{id:'read'})],{stopReason:'toolUse'});},
  ctx=>{observed.push(JSON.stringify(normalizeContext(ctx)));return fauxAssistantMessage([fauxText('found')]);}]);
 await reader.session.prompt('读取今天工作记忆');
 assert.ok(observed.every(x=>x.includes('跨会话工作日记')));
 assert.ok(observed.at(-1).includes('浏览器坐标点击复测'));
 assert.ok(observed.every(x=>!x.includes('private project sentinel')));
 assert.ok(searchMemory({query:'*',project:reader.cwd}).some(x=>x.id===daily.id));
});
test('memory date filters follow the local calendar at UTC midnight boundaries',()=>{
 const previous=process.env.TZ;process.env.TZ='Asia/Shanghai';
 try{
  const fixture={id:'day-fixture',kind:'daily',project:'/other',title:'今日记录',text:'工作',createdAt:'2026-11-04T16:15:00.000Z',updatedAt:'2026-11-04T16:15:00.000Z',deleted:false,revisions:[]};
  assert.equal(searchMemory({query:'*',from:'2026-11-05',to:'2026-11-05',project:'/new'},[fixture]).length,1);
  assert.equal(searchMemory({from:'2026-11-04',to:'2026-11-04'},[fixture]).length,0);
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

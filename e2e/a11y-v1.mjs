import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';

const root=process.cwd(), artifacts=path.join(root,'test-results/a11y-v1');
fs.mkdirSync(artifacts,{recursive:true});
const agent=fs.mkdtempSync(path.join(os.tmpdir(),'pi-a11y-v1-')), project=path.join(agent,'teaching-project');
fs.mkdirSync(project);fs.mkdirSync(path.join(agent,'sessions','fixture'),{recursive:true});
fs.writeFileSync(path.join(agent,'models.json'),JSON.stringify({providers:{'fixture-local':{baseUrl:'http://127.0.0.1:9/v1',apiKey:'NOT_A_REAL_SECRET',api:'openai-completions',models:[{id:'fixture',name:'教学演示模型',contextWindow:16384,maxTokens:4096,input:['text']}]}}}));
fs.writeFileSync(path.join(agent,'settings.json'),JSON.stringify({defaultProvider:'fixture-local',defaultModel:'fixture'}));
const sessions=['甲','乙'].map(suffix=>{
 const id=randomUUID(),title='无障碍历史'+suffix, timestamp=new Date().toISOString();
 const entries=[{type:'session',version:3,id,timestamp,cwd:project},{type:'session_info',id:'n',parentId:null,timestamp,name:title},
  {type:'message',id:'u',parentId:'n',timestamp,message:{role:'user',content:[{type:'text',text:'这是真实切换验收内容'+suffix}],timestamp:Date.now()}},
  {type:'message',id:'a',parentId:'u',timestamp,message:{role:'assistant',content:[{type:'text',text:'已打开教学记录'+suffix}],provider:'fixture-local',model:'fixture',api:'openai-completions',stopReason:'stop',timestamp:Date.now(),usage:{input:12,output:34,cacheRead:0,cacheWrite:0,totalTokens:46,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}}];
 fs.writeFileSync(path.join(agent,'sessions','fixture',timestamp.replaceAll(':','-')+'_'+id+'.jsonl'),entries.map(x=>JSON.stringify(x)).join('\n')+'\n');return{id,title,suffix};
});
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const env={...process.env,NODE_ENV:'production',PI_CODING_AGENT_DIR:agent,PI_WEB_DESKTOP_BUILD:'1',NEXT_TELEMETRY_DISABLED:'1'};
delete env.__NEXT_PRIVATE_STANDALONE_CONFIG;delete env.__NEXT_PRIVATE_ORIGIN;
const log=fs.openSync(path.join(artifacts,'server.log'),'w');
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:root,env,stdio:['ignore',log,log]});
let browser;const results=[];
try{
 const base='http://127.0.0.1:'+port;
 const deadline=Date.now()+60000;while(true){try{if((await fetch(base+'/api/home')).ok)break;}catch{}if(Date.now()>deadline)throw Error('test server not ready');await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 await page.route('**/api/updates',route=>route.fulfill({json:{updates:[],nextCheckAt:new Date(Date.now()+86400000).toISOString()}}));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?session='+sessions[0].id);
 await page.getByRole('button',{name:'打开会话：'+sessions[1].title,exact:true}).waitFor();
 assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');results.push('Chinese document language');
 for(let i=0;i<6;i++){
  if(await page.getByRole('button',{name:'显示历史记录',exact:true}).count())await page.getByRole('button',{name:'显示历史记录',exact:true}).click();
  const item=sessions[(i+1)%2];const button=page.getByRole('button',{name:'打开会话：'+item.title,exact:true});
  if(i<4)await button.evaluate(el=>el.click());
  else{await button.focus();await button.press(i===4?'Enter':'Space');}
  await page.waitForURL(url=>url.searchParams.get('session')===item.id);
  await page.getByText('已打开教学记录'+item.suffix,{exact:true}).waitFor();
  assert.equal(await page.locator('.session-item-title[aria-current=page]').getAttribute('aria-label'),'打开会话：'+item.title);
  await page.waitForFunction(title=>document.activeElement?.getAttribute('role')==='heading'&&document.activeElement.textContent.includes(title),item.title);
 }
 results.push('six history activations: zero-detail click, Enter, Space; correct transcript, selected state and heading focus');
 assert.equal(await page.getByRole('textbox',{name:'给 Pi 发消息…',exact:true}).count(),1);
 results.push('chat input has independent Chinese name');
 if(await page.getByRole('button',{name:'显示历史记录',exact:true}).count())await page.getByRole('button',{name:'显示历史记录',exact:true}).click();
 const sourceButton=page.getByRole('button',{name:'打开会话：'+sessions[0].title,exact:true});
 assert.equal(await sourceButton.evaluate(el=>{const event=new KeyboardEvent('keydown',{key:'ArrowRight',ctrlKey:true,altKey:true,bubbles:true,cancelable:true});el.dispatchEvent(event);return event.defaultPrevented;}),false);
 results.push('VoiceOver modifier chord not intercepted by tree navigation');
 const settings=page.getByRole('button',{name:'设置',exact:true});await settings.evaluate(el=>el.click());
 const dialog=page.getByRole('dialog',{name:'设置',exact:true});await dialog.waitFor();
 await page.waitForFunction(()=>document.activeElement?.closest('[role=dialog]'));
 await dialog.getByRole('button',{name:'返回设置分类',exact:true}).click();
 await dialog.locator('.settings-section-tabs button').filter({hasText:/^模型$/}).click();
 await dialog.locator('.config-sidebar-item').filter({hasText:'fixture-local'}).first().click();
 await dialog.getByRole('textbox',{name:'服务地址',exact:true}).waitFor();
 assert.equal(await dialog.getByRole('textbox',{name:'服务地址',exact:true}).inputValue(),'http://127.0.0.1:9/v1');
 assert.equal(await dialog.getByLabel('接口密钥',{exact:true}).evaluateAll(elements=>elements.filter(el=>el.tagName==='INPUT').length),1);
 results.push('model configuration inputs associated with Chinese visible field names');
 const nameless=await dialog.getByRole('button',{name:'',exact:true}).count();assert.equal(nameless,0);
 results.push('no unnamed visible buttons in selected model configuration');
 await dialog.evaluate(el=>{const controls=Array.from(el.querySelectorAll('button,a[href],input,textarea,select,[tabindex]')).filter(x=>x.tabIndex>=0&&!x.matches(':disabled,[aria-disabled="true"]')&&x.getClientRects().length);window.__a11yFirst=controls[0];window.__a11yLast=controls.at(-1);window.__a11yFirst.focus();});
 await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement===window.__a11yLast),true);
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===window.__a11yFirst),true);results.push('modal Tab and Shift+Tab wrap');
 await page.screenshot({path:path.join(artifacts,'models.png')});
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='设置');results.push('zero-detail settings activation restores focus to the settings trigger');
 assert.ok((await page.locator('.message-meta').allTextContents()).some(text=>text.includes('输入12个词元')&&text.includes('输出34个词元')));results.push('usage units in Chinese');
 await page.screenshot({path:path.join(artifacts,'history.png')});
 assert.deepEqual(errors,[]);results.push('no browser runtime errors');
 fs.writeFileSync(path.join(artifacts,'summary.json'),JSON.stringify({passed:true,results,sessionIds:sessions.map(s=>s.id)},null,2));console.log(JSON.stringify({passed:true,results}));
}catch(error){fs.writeFileSync(path.join(artifacts,'failure.json'),JSON.stringify({error:String(error),results},null,2));throw error;}
finally{await browser?.close();server.kill('SIGTERM');fs.closeSync(log);fs.rmSync(agent,{recursive:true,force:true});}

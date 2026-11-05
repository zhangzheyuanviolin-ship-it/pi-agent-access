import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{runInNewContext}from'node:vm';
import {prepareBrowserEnhancements}from'./templates/browser-runtime.mjs';import{prepareNativeEnhancements}from'./templates/native-runtime.mjs';
import{withRuntimeEnhancements}from'./templates/runtime-overlay.mjs';
test('browser and native enhancement preparation never writes signed app resources',()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-sealed-runtime-'));try{
  const lcuRoot=join(root,'lcu');
  for(const [name,source,prepare]of[
   ['oai_js_browser/dist/skill/scripts/browser-client.js','browser-source-backup.js',prepareBrowserEnhancements],
   ['oai_js_cua/src/tinysky_alt/bind_mac_app.js','native-source-backup.js',prepareNativeEnhancements]]){
   const path=join(lcuRoot,'app/Contents/Resources/cua_node/lib/node_modules/@oai/cua/dist/lib/js',name);mkdirSync(join(path,'..'),{recursive:true});
   const original=Buffer.from('sealed compatibility fixture');writeFileSync(path,original);
   assert.equal(prepare({lcuRoot}),false);assert.deepEqual(readFileSync(path),original,'signed resource changed');
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('external REPL overlay augments fresh app/tab bindings once without input or tool-schema changes',async()=>{
 const app={getAXState:async()=>''},tab={playwright:{},cua:{}},other=()=>42;
 const original={getApp:async()=>app,getTab:async()=>tab,createBrowserTab:async()=>tab,listApps:other};const globals={cua:original};globals.globalThis=globals;
 const code=withRuntimeEnhancements('globalThis.bound = await cua.getApp("fixture");',{browser:true,native:true});
 await runInNewContext('(async()=>{'+code+'})()',globals);
 assert.equal(typeof app.getAXValue,'function');assert.equal(globals.bound,app);assert.equal(await globals.cua.listApps(),42);
 const first=globals.cua;await runInNewContext('(async()=>{'+withRuntimeEnhancements('await cua.getTab("own");',{browser:true,native:true})+'})()',globals);
 assert.equal(globals.cua,first);assert.equal(typeof tab.hover,'function');assert.equal(typeof tab.pressAndVerify,'function');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const bootstrap=require('../computer-use/bootstrap.cjs');
test('profile setup preserves existing extensions and settings without duplicates',()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-access-profile-'));
 try{
  writeFileSync(join(root,'settings.json'),JSON.stringify({extensions:['existing.mjs'],defaultModel:'existing-model',customValue:42}));
  bootstrap.initializeProfile(root,'managed.mjs');bootstrap.initializeProfile(root,'managed.mjs');
  assert.deepEqual(JSON.parse(readFileSync(join(root,'settings.json'),'utf8')),{extensions:['existing.mjs','managed.mjs'],defaultModel:'existing-model',customValue:42});
  assert.equal(existsSync(join(root,'auth.json')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('damaged existing profile is not replaced with defaults',()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-access-damaged-'));
 try{writeFileSync(join(root,'settings.json'),'broken');assert.throws(()=>bootstrap.initializeProfile(root,'managed.mjs'));assert.equal(readFileSync(join(root,'settings.json'),'utf8'),'broken');}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('distribution templates contain no developer-specific absolute path',()=>{
 for(const name of ['index.mjs','adapter.ts','result.mjs','image-frame.mjs','image-metadata.mjs','access-policy.mjs']){
  const source=readFileSync(new URL('../computer-use/templates/'+name,import.meta.url),'utf8');assert.doesNotMatch(source,/\/Users\/zhangzheyuan/);
 }
 assert.match(readFileSync(new URL('../computer-use/templates/index.mjs',import.meta.url),'utf8'),/__LCU_ROOT__/);
});
test('permission-changing setup requires native desktop authorization',()=>{
 const source=readFileSync(new URL('../app/api/computer-use/setup/route.ts',import.meta.url),'utf8');assert.match(source,/isDesktopApiRequestAllowed\(req\)/);
});
test('thin bundle excludes private installation state and OpenAI app payload',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../vendor/lcu/bundle.json',import.meta.url),'utf8'));
 assert.equal(manifest.platform,'darwin');assert.equal(manifest.architecture,'arm64');
 for(const name of Object.keys(manifest.files))assert.doesNotMatch(name,/^(app\/|installation\.json$|node-path$)|auth\.json|profiles\//);
 assert.equal(existsSync(new URL('../vendor/lcu/app',import.meta.url)),false);
});

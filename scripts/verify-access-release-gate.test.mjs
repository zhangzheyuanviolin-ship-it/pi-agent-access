import test from'node:test';import assert from'node:assert/strict';import{REQUIRED,validateGate,sourceFingerprint,validateGateTargets,validateBetaEngineBindings}from'./verify-access-release-gate.mjs';
function gate(){return{version:1,sourceDigest:'source',completedAt:new Date().toISOString(),localModelCount:7,checks:Object.fromEntries(REQUIRED.map(id=>[id,{status:'passed',evidence:[{path:'/not-read-in-unit-test',sha256:'a'.repeat(64)}]}]))};}
test('valid complete attestation is accepted',()=>assert.deepEqual(validateGate(gate(),{sourceDigest:'source',verifyEvidence:false}),[]));
test('every missing historical regression independently blocks release',()=>{for(const id of REQUIRED){const g=gate();delete g.checks[id];assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).some(x=>x.includes(id)));}});
test('pending, failed, skipped and unknown results cannot count as passes',()=>{for(const status of ['pending','failed','skipped','unverified']){const g=gate();g.checks.video_cloud_mobile.status=status;assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).length);}});
test('changed source, old or future evidence, changed roster are rejected',()=>{const g=gate();assert.ok(validateGate(g,{sourceDigest:'different',verifyEvidence:false}).length);g.completedAt='2020-01-01';assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).length);g.completedAt='2099-01-01';assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).length);g.localModelCount=5;assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).length);});
test('evidence must exist and match, even when status says passed',()=>assert.ok(validateGate(gate(),{sourceDigest:'source'}).length));

test('current repository fingerprint can be calculated',()=>assert.match(sourceFingerprint(),/^[a-f0-9]{64}$/));


test('a proof cannot redirect validation away from the actual packaging source or target',()=>{
 const g={sourceDirectory:'/tested/A',runtimeDirectory:'/tested/runtimeA'};
 assert.equal(validateGateTargets(g,{sourceDirectory:'/packaged/B',runtimeDirectory:'/packaged/runtimeB'}).length,2);
 assert.deepEqual(validateGateTargets(g,{sourceDirectory:'/tested/A',runtimeDirectory:'/tested/runtimeA'}),[]);
});

test('beta evidence must cover its explicit complete model roster',async()=>{
 const{readFileSync}=await import('node:fs');const roster=JSON.parse(readFileSync(new URL('../docs/beta-model-roster.json',import.meta.url)));
 const g={...gate(),distributionProfile:'beta',localModelCount:roster.modelIds.length,modelIds:roster.modelIds};
 assert.deepEqual(validateGate(g,{sourceDigest:'source',verifyEvidence:false}),[]);
 for(const id of roster.modelIds){const missing={...g,modelIds:g.modelIds.filter(x=>x!==id)};assert.ok(validateGate(missing,{sourceDigest:'source',verifyEvidence:false}).some(x=>x.includes('roster')));}
 assert.ok(validateGate({...g,localModelCount:7},{sourceDigest:'source',verifyEvidence:false}).length);
});
test('beta engine code and signing/permission configuration participate in source identity',async()=>{
 const{mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join,dirname}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'pi-beta-digest-'));
 try{for(const name of ['beta-runtime/beta_gateway.py','beta-runtime/resource_admission.py','src-tauri/tauri.beta.conf.json','src-tauri/Info.beta.plist','src-tauri/Entitlements.beta.plist','docs/beta-model-roster.json']){
 const before=sourceFingerprint(dir);const path=join(dir,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'new candidate content');assert.notEqual(sourceFingerprint(dir),before,name);
 }}finally{rmSync(dir,{recursive:true,force:true});}
});

test('beta gate binds actual native config, reviewed source, binary and libraries',async()=>{
 const{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const{createHash}=await import('node:crypto');
 const dir=mkdtempSync(join(tmpdir(),'pi-native-binding-'));const build=join(dir,'native/build');mkdirSync(build,{recursive:true});mkdirSync(join(dir,'private'));
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');const binary=join(build,'server'),lib=join(build,'lib.dylib'),configPath=join(dir,'private/minicpm.json'),pinPath=join(dir,'private/minicpm-engine.json');
 try{
  writeFileSync(binary,'native fixture');writeFileSync(lib,'library fixture');
  const pin={binary,sha256:hash(binary),buildRoot:build,sourceManifestSha256:hash(new URL('../local-engines/minicpm-beta-source.json',import.meta.url)),runtimeFiles:[{path:binary,sha256:hash(binary)},{path:lib,sha256:hash(lib)}]};
  writeFileSync(pinPath,JSON.stringify(pin));writeFileSync(configPath,JSON.stringify({binary,native_port:12452,output_dir:join(dir,'audio')}));
  const g={distributionProfile:'beta',modelIds:['MiniCPM-o-4.5-F16'],runtimeEvidence:[['beta_minicpm_config',configPath],['beta_minicpm_engine_pin',pinPath],['beta_minicpm_binary',binary]].map(([id,path])=>({id,path,sha256:hash(path)}))};
  assert.deepEqual(validateBetaEngineBindings(g,{dataRoot:dir}),[]);
  for(const id of g.runtimeEvidence.map(e=>e.id))assert.ok(validateBetaEngineBindings({...g,runtimeEvidence:g.runtimeEvidence.filter(e=>e.id!==id)},{dataRoot:dir}).length);
  writeFileSync(lib,'changed library');assert.ok(validateBetaEngineBindings(g,{dataRoot:dir}).some(x=>x.includes('dependency')));writeFileSync(lib,'library fixture');
  writeFileSync(binary,'old binary');assert.ok(validateBetaEngineBindings(g,{dataRoot:dir}).length);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('withdrawn beta candidates cannot activate or become rollback baselines',async()=>{
 const {validateBetaRevocation}=await import('./verify-access-release-gate.mjs');
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const dataRoot=mkdtempSync(join(tmpdir(),'beta-revocation-'));
 try{
  mkdirSync(join(dataRoot,'private'));const file=join(dataRoot,'private/revoked-candidates.json');
  writeFileSync(file,JSON.stringify({format:1,candidates:[{sourceDigest:'known-failure',activationAllowed:false,rollbackAllowed:false}]}));
  assert.match(validateBetaRevocation({distributionProfile:'beta',sourceDigest:'known-failure'},{dataRoot}).join(),/revoked/);
  assert.deepEqual(validateBetaRevocation({distributionProfile:'beta',sourceDigest:'new-candidate'},{dataRoot}),[]);
  assert.deepEqual(validateBetaRevocation({distributionProfile:'stable',sourceDigest:'known-failure'},{dataRoot}),[]);
  writeFileSync(file,'broken');assert.match(validateBetaRevocation({distributionProfile:'beta',sourceDigest:'new-candidate'},{dataRoot}).join(),/invalid/);
 }finally{rmSync(dataRoot,{recursive:true,force:true});}
});

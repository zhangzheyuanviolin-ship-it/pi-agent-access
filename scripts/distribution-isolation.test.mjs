import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';import{readFileSync}from'node:fs';
const{distributionProfile,applyDistributionProfile}=createRequire(import.meta.url)('../desktop/distribution-profile.cjs');
test('beta never inherits stable agent directory or shared backend',()=>{const env={PI_ACCESS_PROFILE:'beta',PI_CODING_AGENT_DIR:'/stable/agent',PI_WEB_SHARED_BACKEND_URL:'http://127.0.0.1:30143',PI_WEB_SHARED_BACKEND_PASSWORD:'test-only'};const p=applyDistributionProfile(env,'/test/home');assert.equal(p.agentDir,'/test/home/Library/Application Support/Pi Agent Access Beta/agent');assert.equal(p.sharedConfigPath,undefined);assert.equal(p.desktopPort,38472);assert.equal(p.allowBrowserRegistrationRepair,false);assert.equal(env.PI_WEB_SHARED_BACKEND_URL,undefined);assert.equal(env.PI_WEB_SHARED_BACKEND_PASSWORD,undefined);});
test('stable profile retains existing endpoints and explicit agent dir',()=>{const env={PI_CODING_AGENT_DIR:'/existing/agent'};const p=applyDistributionProfile(env,'/test/home');assert.equal(p.agentDir,'/existing/agent');assert.equal(p.desktopPort,38471);assert.equal(p.sharedConfigPath,'/test/home/.pi/agent/shared-backend.json');assert.deepEqual(env,{PI_CODING_AGENT_DIR:'/existing/agent'});});
test('launcher selects distribution before reading any shared config',()=>{const s=readFileSync(new URL('../desktop/server-launcher.cjs',import.meta.url),'utf8');assert.ok(s.indexOf('applyDistributionProfile')<s.indexOf('sharedConfigPath'));assert.match(s,/profile\.sharedConfigPath/);});

test('beta omni rejects stable gateway, including an explicit copied setting',async()=>{
 const {createJiti}=await import('jiti');const jiti=createJiti(import.meta.url,{moduleCache:false});
 const {omniGateway}=await jiti.import('../lib/local-omni.ts');
 const before=process.env.PI_ACCESS_PROFILE;process.env.PI_ACCESS_PROFILE='beta';
 try{assert.equal(omniGateway({}),'http://127.0.0.1:12449');assert.throws(()=>omniGateway({gatewayUrl:'http://127.0.0.1:12349'}),/独立/);}
 finally{if(before===undefined)delete process.env.PI_ACCESS_PROFILE;else process.env.PI_ACCESS_PROFILE=before;}
});
test('beta native recipe and admission regressions execute in the full suite',async()=>{
 const{spawnSync}=await import('node:child_process');const r=spawnSync('/usr/bin/python3',['-B','-m','unittest','discover','-s','beta-runtime','-p','test_*.py'],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stdout+r.stderr);
 const profile=spawnSync('/usr/bin/python3',['-B','scripts/test_beta_profile.py'],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:15000});assert.equal(profile.status,0,profile.stdout+profile.stderr);
});

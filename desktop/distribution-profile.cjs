'use strict';
const {join,resolve}=require('node:path');
const {homedir}=require('node:os');
/** Explicit build/runtime channel. Never infer beta from a session or user request. */
function distributionProfile(env=process.env,home=homedir()){
 const beta=env.PI_ACCESS_PROFILE==='beta';
 const dataRoot=join(home,'Library/Application Support',beta?'Pi Agent Access Beta':'Pi Agent Access');
 const agentDir=beta?join(dataRoot,'agent'):(env.PI_CODING_AGENT_DIR||join(home,'.pi/agent'));
 return {beta,dataRoot,agentDir,desktopPort:beta?38472:38471,sharedConfigPath:beta?undefined:join(home,'.pi/agent/shared-backend.json'),allowBrowserRegistrationRepair:!beta};
}
function applyDistributionProfile(env=process.env,home=homedir()){
 const profile=distributionProfile(env,home);
 if(profile.beta){
  env.PI_CODING_AGENT_DIR=profile.agentDir;env.PI_ACCESS_DATA_ROOT=profile.dataRoot;
  delete env.PI_WEB_PASSWORD;
  env.PATH=join(profile.agentDir,'bin')+require('node:path').delimiter+(env.PATH||'');
  delete env.PI_WEB_SHARED_BACKEND_URL;delete env.PI_WEB_SHARED_BACKEND_PASSWORD;
 }
 return profile;
}
module.exports={distributionProfile,applyDistributionProfile};

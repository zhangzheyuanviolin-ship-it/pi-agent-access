import {mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
// Independent Pi host environment. User authorized isolation on 2026-11-02.
// Keep original per-app/per-origin approval; never modify global process.env.
export function independentRuntimeEnvironment(source, approved = false) {
 const env={...source};
 if(approved!==true)return env;
 for(const key of ['BROWSER_USE_ACCESS_EXECUTOR_ID','BROWSER_USE_ACCESS_PIPE_PATH','BROWSER_USE_ACCESS_VERIFYING_IDENTITY'])delete env[key];
 return env;
}

export function piRuntimeEnvironment(source, stateDirectory=join(homedir(),'Library/Application Support/Pi Agent Access/computer-use-state')) {
 const env=independentRuntimeEnvironment(source,true);
 mkdirSync(stateDirectory,{recursive:true,mode:0o700});env.CODEX_HOME=stateDirectory;return env;
}

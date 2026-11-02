import lcu from './adapter.ts';
import {withImageFrames} from './image-frame.mjs';
import {createWindowRecovery} from './window-recovery.mjs';
import {createObservationDiff} from './observation-diff.mjs';
export default pi=>{const recovery=createWindowRecovery(), observations=createObservationDiff();pi.on('session_compact',()=>observations.clear());return lcu(new Proxy(pi,{get(target,key){
 if(key==='on')return (name,handler)=>target.on(name,async(...args)=>{if(name==='agent_start'){recovery.newTurn();observations.clear();}return handler(...args);});
 if(key==='registerTool')return tool=>target.registerTool(recovery.wrap({...tool,async execute(...args){if(tool.name==='js_reset')observations.clear();const result=withImageFrames(await tool.execute(...args));return tool.name==='js'?observations.transform(result,{sessionId:args[4]?.sessionManager?.getSessionId?.()||'unknown',callId:args[0]}):result;}}));
 const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;
}}),{command:['__LCU_ROOT__/bin/lcu','--chrome']});};

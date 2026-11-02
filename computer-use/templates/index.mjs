import lcu from './adapter.ts';
import {withImageFrames} from './image-frame.mjs';
import {createWindowRecovery} from './window-recovery.mjs';
export default pi=>{const recovery=createWindowRecovery();return lcu(new Proxy(pi,{get(target,key){
 if(key==='on')return (name,handler)=>target.on(name,async(...args)=>{if(name==='agent_start')recovery.newTurn();return handler(...args);});
 if(key==='registerTool')return tool=>target.registerTool(recovery.wrap({...tool,async execute(...args){return withImageFrames(await tool.execute(...args));}}));
 const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;
}}),{command:['__LCU_ROOT__/bin/lcu','--chrome']});};

import lcu from './adapter.ts';
import {withImageFrames} from './image-frame.mjs';
export default pi=>lcu(new Proxy(pi,{get(target,key){
 if(key==='registerTool')return tool=>target.registerTool({...tool,async execute(...args){return withImageFrames(await tool.execute(...args));}});
 const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;
}}),{command:['__LCU_ROOT__/bin/lcu','--chrome']});

import {withRuntimeEnhancements} from './runtime-overlay.mjs';
import {prepareNativeEnhancements} from './native-runtime.mjs';
import {prepareBrowserEnhancements} from './browser-runtime.mjs';
import {withPagedText} from './paged-text.mjs';
import {withActionGuidance} from './action-guidance.mjs';
import lcu from './adapter.ts';
import {createBrowserRegistrationRecovery} from './browser-registration.mjs';
import {fileURLToPath} from 'node:url';
import {withImageFrames} from './image-frame.mjs';
import {createWindowRecovery} from './window-recovery.mjs';
import {createObservationDiff} from './observation-diff.mjs';
export default pi=>{const enhancedBrowser=prepareBrowserEnhancements({lcuRoot:'__LCU_ROOT__'});const nativeAppHelpers=prepareNativeEnhancements({lcuRoot:'__LCU_ROOT__'});let enhancedGuideSent=false;const checkBrowser=createBrowserRegistrationRecovery({lcuRoot:'__LCU_ROOT__',extensionDir:fileURLToPath(new URL('.',import.meta.url))});const recovery=createWindowRecovery(), observations=createObservationDiff();pi.on('session_compact',()=>{observations.clear();enhancedGuideSent=false;});return lcu(new Proxy(pi,{get(target,key){
 if(key==='on')return (name,handler)=>target.on(name,async(...args)=>{if(name==='agent_start'){recovery.newTurn();observations.clear();}return handler(...args);});
 if(key==='registerTool')return tool=>target.registerTool(recovery.wrap({...tool,async execute(...args){if(tool.name==='js_reset'){observations.clear();enhancedGuideSent=false;}const browserNote=tool.name==='js'?await checkBrowser():undefined;const actualArgs=tool.name==='js'?[args[0],{...args[1],code:withRuntimeEnhancements(args[1].code,{browser:enhancedBrowser,native:nativeAppHelpers})},...args.slice(2)]:args;const baseResult=withActionGuidance(withImageFrames(await tool.execute(...actualArgs)),{enhancedBrowser,nativeAppHelpers,showEnhancedGuide:tool.name==='js'&&!enhancedGuideSent});if(tool.name==='js'&&(enhancedBrowser||nativeAppHelpers))enhancedGuideSent=true;const browserStateNote=tool.name==='js'&&baseResult.content?.some(b=>b.type==='text'&&/browsers=\[\]|Browser.*not found|Browser.*does not exist|No browsers|浏览器不存在/i.test(b.text||''))?'浏览器清单为空不等于浏览器功能不可用。Chrome未启动或扩展尚未连接时会出现此状态；先用cua.getApp("/Applications/Google Chrome.app")启动并绑定已有Chrome，再重新读取浏览器清单。此运行时是Chrome扩展通道，不要假定存在内置iab；Chrome创建标签使用sessionName，不传visible。仍为空时报告尚未连接，不宣称功能缺失。':undefined;if(browserStateNote)baseResult.content.push({type:'text',text:browserStateNote});const result=browserNote?{...baseResult,content:[...baseResult.content,{type:'text',text:browserNote}]}:baseResult;return withPagedText(tool.name==='js'?observations.transform(result,{sessionId:args[4]?.sessionManager?.getSessionId?.()||'unknown',callId:args[0]}):result);}}));
 const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;
}}),{command:['__LCU_ROOT__/bin/lcu','--chrome']});};

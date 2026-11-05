import{readFileSync}from'node:fs';
const browserMethods=readFileSync(new URL('./browser-tab-methods.js.txt',import.meta.url),'utf8');
const nativeMethods=readFileSync(new URL('./native-app-methods.js.txt',import.meta.url),'utf8');
/** Extend only objects in Pi's own JS execution context. Never edit a signed runtime. */
export function withRuntimeEnhancements(code,{browser=false,native=false}={}){
 if(!browser&&!native)return code;
 return `{
 const key=Symbol.for('pi.external-cu-enhancements.v1');
 if(!globalThis[key]){
  const tabs=Object.getOwnPropertyDescriptors(class{${browserMethods}}.prototype);delete tabs.constructor;
  const apps=Object.getOwnPropertyDescriptors({${nativeMethods}});
  const decorate=(value,kind)=>{if(value&&typeof value==='object')Object.defineProperties(value,kind==='app'?apps:tabs);return value;};
  const original=globalThis.cua;
  globalThis.cua=new Proxy(original,{get(target,name){const value=Reflect.get(target,name);if(typeof value!=='function')return value;
   if(${native}&&name==='getApp')return async(...args)=>decorate(await value.apply(target,args),'app');
   if(${browser}&&(name==='getTab'||name==='createBrowserTab'))return async(...args)=>decorate(await value.apply(target,args),'tab');
   return value.bind(target);
  }});globalThis[key]=true;
 }
}
${code}`;
}

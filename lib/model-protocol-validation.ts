import {ModelRuntime} from '@earendil-works/pi-coding-agent';
export class ModelProtocolError extends Error {}
/** Offline validation: no credentials are resolved and no inference/network is performed. */
export async function assertModelProtocolPairs(data:Record<string,unknown>){
 const rt=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false});const builtins=rt.getAllModels();
 const providers=(data.providers??{}) as Record<string,{api?:string;baseUrl?:string;models?:{id:string;api?:string;baseUrl?:string}[]}>;
 for(const [name,p]of Object.entries(providers)){
  const baseline=builtins.find(m=>m.provider===name);const api=p.api??baseline?.api;const base=p.baseUrl??baseline?.baseUrl;
  const validate=(label:string,a:string|undefined,b:string|undefined,nativeApi?:string,nativeBase?:string)=>{
   if(!a||!b)return;
   const openai=(v:string)=>v.startsWith('openai-');
   if(openai(a)&&/\/anthropic(?:\/|$)/i.test(new URL(b).pathname))throw new ModelProtocolError(label+'：OpenAI协议不能使用Anthropic端点，请同时配置匹配的端点或继承默认协议');
   if(nativeApi&&nativeBase&&a!==nativeApi&&b.replace(/\/$/,'')===nativeBase.replace(/\/$/,'')&&!(openai(a)&&openai(nativeApi)))throw new ModelProtocolError(label+'：协议已改变但仍沿用原协议端点，请检查配套端点');
  };
  validate(name,api,base,baseline?.api,baseline?.baseUrl);
  for(const model of p.models??[])validate(name+'/'+model.id,model.api??api,model.baseUrl??base,baseline?.api,baseline?.baseUrl);
 }
}

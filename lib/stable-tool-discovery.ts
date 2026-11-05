/** Keep discovery results in tool messages, never promote them into the prompt prefix. */
import {Type} from '@earendil-works/pi-ai';
import type {ExtensionFactory,ToolDefinition} from '@earendil-works/pi-coding-agent';

export function stableMcpDeclarations(factory:ExtensionFactory):ExtensionFactory{return async pi=>{
 const names=new Set<string>();
 const withoutMcp=(active:string[])=>active.filter(name=>!names.has(name));
 const wrapped=new Proxy(pi,{get(target,key){
  if(key==='registerTool')return (definition:ToolDefinition)=>{
   names.add(definition.name);
   const result=target.registerTool({...definition,exposure:definition.exposure==='hidden'?'hidden':'deferred',defaultActive:false});
   if(definition.exposure!=='hidden'&&target.getAllTools().some(t=>t.name==='tool_search'&&t.reachesTools)){
    const active=target.getActiveTools();if(!active.includes('tool_search'))target.setActiveTools([...withoutMcp(active),'tool_search']);
   }
   return result;
  };
  if(key==='setActiveTools')return (active:string[])=>target.setActiveTools(withoutMcp(active));
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await factory(wrapped);
 pi.on('before_agent_start',(event,ctx)=>{
  const active=pi.getActiveTools();const next=withoutMcp(active);if(next.length!==active.length)pi.setActiveTools(next);
  // Save only this volatile metadata section, never rewrite system/user history.
  // A user-applied capability snapshot is the explicit refresh boundary.
  const entries=ctx.sessionManager.getEntries();
  const policy=[...entries].reverse().find(e=>e.type==='custom'&&e.customType==='pi-web:context-capabilities-v1') as {data?:{createdAt?:string}}|undefined;
  const epoch=policy?.data?.createdAt??'legacy';
  const saved=[...entries].reverse().find(e=>e.type==='custom'&&e.customType==='pi-web:mcp-stable-section-v1'&&(e.data as {epoch?:string}|undefined)?.epoch===epoch) as {data:{section:string}}|undefined;
  const section=saved?.data.section??event.systemPromptOptions.sections.mcp_servers??'';
  if(!saved)pi.appendEntry('pi-web:mcp-stable-section-v1',{epoch,section});
  if(section)event.systemPromptOptions.sections.mcp_servers=section;
  else delete event.systemPromptOptions.sections.mcp_servers;
 });
};}

/** The SDK code executor remains unchanged; only its catalog-dependent description is fixed. */
export function stableCodemodeDescription(factory:ExtensionFactory):ExtensionFactory{return async pi=>{
 const wrapped=new Proxy(pi,{get(target,key){
  if(key==='registerTool')return (definition:ToolDefinition)=>{
   if(definition.name!=='codemode')return target.registerTool(definition);
   const description=definition.description;
   const prepare=definition.prepareLoadout;
   return target.registerTool({...definition,defaultActive:true,prepareLoadout:loadout=>{
    const result=prepare?.(loadout);
    return {...result,descriptions:{...result?.descriptions,codemode:description}};
   }});
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await factory(wrapped);
};}

export const stableToolSearch:ExtensionFactory=pi=>{
 pi.registerTool({name:'tool_search',label:'查找或调用工具',exposure:'model-only',defaultActive:true,
 description:'Find callable tools and schemas by query, or call one by exact name and arguments. Search does not change tool declarations. Use call for a discovered tool; codemode can also invoke it.',
 parameters:Type.Object({query:Type.Optional(Type.String()),limit:Type.Optional(Type.Integer({minimum:1,maximum:8})),call:Type.Optional(Type.Object({name:Type.String(),arguments:Type.Record(Type.String(),Type.Unknown())}))}),
 reachesTools:args=>{const call=args.call as {name?:unknown}|undefined;return typeof call?.name==='string'?[call.name]:'all';},
 async execute(_id,args,signal,update,ctx){
  const callable=ctx.tools.filter(t=>t.name!=='tool_search'&&t.name!=='codemode');
  if(args.call){
   if(!callable.some(t=>t.name===args.call!.name))throw Error('工具不存在、未启用或不可嵌套调用');
   const result=await ctx.executeTool(args.call.name,args.call.arguments,{signal,onUpdate:update});
   if(result.isError)throw Error(result.result.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')||'工具调用失败');
   return result.result;
  }
  const query=args.query?.trim().toLowerCase();if(!query)throw Error('请提供搜索词或调用参数');
  const terms=query.split(/\s+/);const rows=callable.map(t=>({t,score:terms.reduce((s,w)=>s+Number((t.name+' '+t.description).toLowerCase().includes(w)),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.t.name.localeCompare(b.t.name)).slice(0,args.limit??5).map(({t})=>({name:t.name,description:t.description,parameters:t.parameters}));
  return {content:[{type:'text',text:JSON.stringify(rows)}],details:{discoveryOnly:true}};
 }});
};

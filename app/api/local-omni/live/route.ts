import {isApiRequestAllowed,hasJsonContentType} from '@/lib/request-security';
import {OMNI_MODELS,omniSettings,omniGateway} from '@/lib/local-omni';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 if(!isApiRequestAllowed(req)||!hasJsonContentType(req))return Response.json({error:'请求被拒绝'},{status:403});
 try{
  const raw=await req.text();if(raw.length>3*1024*1024)throw Error('实时分片超过容量');const body=JSON.parse(raw);
  const kind=(Object.keys(OMNI_MODELS) as (keyof typeof OMNI_MODELS)[]).find(k=>OMNI_MODELS[k]===body.model);
  const settings=omniSettings();if(!kind||!settings?.enabled||!settings.models[kind]?.enabled||!settings.models[kind]?.live)throw Error('所选实时模型尚未开放');
  if(!['start','append','events','interrupt','stop'].includes(body.action))throw Error('实时操作无效');
  if(body.action!=='start'&&!/^[a-f0-9]{32}$/.test(body.sessionId))throw Error('实时会话编号无效');
  const response=await fetch(omniGateway(settings)+'/v1/omni/live',{method:'POST',headers:{'Content-Type':'application/json'},body:raw,signal:req.signal});
  return new Response(response.body,{status:response.status,headers:{'Content-Type':response.headers.get('Content-Type')??'application/json','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'实时连接失败'},{status:400});}
}

import {NextResponse} from 'next/server';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {getRpcSession,startRpcSession} from '@/lib/rpc-manager';
import {resolveSessionPath} from '@/lib/session-reader';
import {hasJsonContentType,isApiRequestAllowed} from '@/lib/request-security';
import {OMNI_PREFERENCES,omniSpeechPreference,omniSettings} from '@/lib/local-omni';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const id=new URL(req.url).searchParams.get('sessionId')??'';const live=getRpcSession(id);const path=live?.sessionFile??await resolveSessionPath(id);
 const manager=live?.inner.sessionManager??(path?SessionManager.open(path):undefined);if(!manager)throw Error('会话不存在');
 return NextResponse.json({speech:omniSpeechPreference(manager.getEntries()),models:omniSettings()?.models??{}});
}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'读取失败'},{status:400});}}
export async function POST(req:Request){
 if(!isApiRequestAllowed(req)||!hasJsonContentType(req))return NextResponse.json({error:'请求被拒绝'},{status:403});
 try{const body=await req.json();if(typeof body.sessionId!=='string'||typeof body.speech!=='boolean')throw Error('设置无效');
 const live=getRpcSession(body.sessionId);const path=live?.sessionFile??await resolveSessionPath(body.sessionId);if(!live&&!path)throw Error('会话不存在');
 const session=live??(await startRpcSession(body.sessionId,path!,undefined)).session;if(session.isRunning())throw Error('请等待当前回复结束');
 session.inner.sessionManager.appendCustomEntry(OMNI_PREFERENCES,{speech:body.speech});return NextResponse.json({speech:body.speech});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'保存失败'},{status:400});}
}

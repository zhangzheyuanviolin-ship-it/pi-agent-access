import {NextResponse} from 'next/server';
import {isApiRequestAllowed,hasJsonContentType} from '@/lib/request-security';
import {inventory} from '@/lib/context-capabilities/runtime';
import {setPluginApproved} from '@/lib/context-capabilities/plugin-access';
import {getAllowedFileRoots,isExistingFilePathAllowed} from '@/lib/file-access';
export const dynamic='force-dynamic';
async function checked(cwd:unknown){if(typeof cwd!=='string'||!await isExistingFilePathAllowed(cwd,await getAllowedFileRoots()))throw new Error('项目不可访问');return inventory(cwd);}
export async function GET(req:Request){try{return NextResponse.json(await checked(new URL(req.url).searchParams.get('cwd')));}catch{return NextResponse.json({error:'无法读取插件'},{status:400});}}
export async function POST(req:Request){if(!isApiRequestAllowed(req)||!hasJsonContentType(req))return NextResponse.json({error:'请求被拒绝'},{status:403});try{const b=await req.json();const data=await checked(b.cwd);if(typeof b.enabled!=='boolean'||!data.plugins.some(p=>p.path===b.path&&p.enabled))throw new Error('插件尚未安装启用');setPluginApproved(b.path,b.enabled);return NextResponse.json({success:true});}catch(e){return NextResponse.json({error:String(e)},{status:400});}}

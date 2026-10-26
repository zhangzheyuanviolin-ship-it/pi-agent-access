import {NextResponse} from 'next/server';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {isDesktopApiRequestAllowed} from '@/lib/desktop-api-auth';
export const runtime='nodejs';
function bootstrap(){
 const file=join(process.cwd(),'access-distribution/bootstrap.cjs');
 if(!existsSync(file))return undefined;
 // Keep this as a native Node require: webpack's static createRequire transform
 // otherwise replaces external runtime files with an empty module context.
 return process.getBuiltinModule('module').createRequire(join(process.cwd(),'package.json'))(file) as {prepare:(options?:{enable?:boolean})=>{available:boolean;automaticAccess:boolean;message:string};readStatus:()=>{available:boolean;automaticAccess:boolean;message:string}};
}
export async function GET(){const helper=bootstrap();return NextResponse.json(helper?helper.readStatus():{available:false,automaticAccess:false,message:'电脑操作安装引导仅在桌面安装包中提供。'});}
export async function POST(req:Request){
 if(!isDesktopApiRequestAllowed(req))return NextResponse.json({error:'请在桌面应用中启用'}, {status:403});
 const body=await req.json();if(body.enable!==true)return NextResponse.json({error:'请明确选择启用'}, {status:400});
 const helper=bootstrap();if(!helper)return NextResponse.json({error:'请使用桌面安装包'}, {status:400});
 return NextResponse.json(helper.prepare({enable:true}));
}

import {omniSettings} from '@/lib/local-omni';
export const dynamic='force-dynamic';
export async function GET(){try{const settings=omniSettings();return Response.json({enabled:settings?.enabled??false,models:settings?.enabled?settings.models:{}});}catch{return Response.json({error:'本地全模态配置不可用'},{status:503});}}

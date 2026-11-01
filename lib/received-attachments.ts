export const RECEIVED_ATTACHMENT='pi-web:received-attachment';
export const NOTIFIED_ATTACHMENTS='pi-web:notified-attachments';
export type ReceivedFile={id:string;name:string;path:string;size:number};
export function pendingAttachments(entries:readonly {type:string;customType?:string;data?:unknown}[]):ReceivedFile[]{
 const seen=new Set<string>();const files=new Map<string,ReceivedFile>();for(const e of entries){if(e.customType===NOTIFIED_ATTACHMENTS){const ids=(e.data as {ids?:string[]})?.ids;for(const id of ids??[])seen.add(id);}if(e.customType===RECEIVED_ATTACHMENT){const f=e.data as ReceivedFile;if(f?.id&&f.path)files.set(f.id,f);}}return [...files.values()].filter(f=>!seen.has(f.id));
}
export function attachmentNotice(files:ReceivedFile[]){return files.length?'\n\n本次已接收的附件已保存在这台Mac，准确位置如下；请按需读取这些路径，不要搜索其他目录，也不要把二进制整体加入上下文：\n'+files.map(f=>JSON.stringify({文件名:f.name,路径:f.path,字节数:f.size})).join('\n'):'';}
export const DELIVERY_NOTIFIED='pi-web:delivery-instructions-v1';
export const DELIVERY_GUIDE='\n\n文件交付：本机已提供 pi-file publish "绝对路径"。完成文件后用 bash 执行该命令，将返回的下载链接原样提供给用户；不要另开HTTP服务器或让用户到电脑查找。';
export function needsDeliveryGuide(entries:readonly {type:string;customType?:string}[]){return !entries.some(e=>e.customType===DELIVERY_NOTIFIED);}

/** Only new uploads get this notice; no historical prompt is rebuilt. */
export function videoAttachmentNotice(files:ReceivedFile[]){return files.some(f=>/\.mp4$/i.test(f.name))?"\n视频附件：如需理解其中画面和时序，使用当前模型的 video_analyze 工具读取上述准确路径；若当前模型未提供该工具，明确告知能力限制，不猜测内容、不擅自更换模型。":"";}

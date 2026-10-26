import type { SessionEntry } from './types';
export const MESSAGE_REMOVAL_TYPE='pi-web:message-removal';
/** Branch-local UI deletion, paired with SDK context edits by the route. */
export function removedMessageIds(branch: readonly SessionEntry[]): Set<string> {
 const hidden=new Set<string>();
 for(const e of branch){if(e.type!=='custom'||e.customType!==MESSAGE_REMOVAL_TYPE)continue;const d=e.data as {targets?:unknown;restore?:boolean};if(!Array.isArray(d?.targets))continue;for(const id of d.targets)if(typeof id==='string'){if(d.restore)hidden.delete(id);else hidden.add(id);}}
 return hidden;
}
export function messageRemovalTargets(branch: readonly SessionEntry[], id:string):string[]{
 const target=branch.find(e=>e.id===id);if(!target||target.type!=='message'||!['user','assistant'].includes(target.message.role))throw Error('只能删除当前分支中的用户或助手消息');
 if(removedMessageIds(branch).has(id))throw Error('此消息已经删除');
 const calls=new Set<string>();
 if(target.message.role==='assistant'&&Array.isArray(target.message.content))for(const b of target.message.content){const block=b as unknown as {type:string;id?:string;toolCallId?:string};if(block.type==='toolCall')calls.add(block.id??block.toolCallId??'');}
 return [id,...branch.filter(e=>e.type==='message'&&e.message.role==='toolResult'&&calls.has(e.message.toolCallId)).map(e=>e.id)];
}

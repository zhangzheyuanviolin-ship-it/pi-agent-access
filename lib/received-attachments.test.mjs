import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingAttachments,attachmentNotice,needsDeliveryGuide,DELIVERY_NOTIFIED} from './received-attachments.ts';
test('attachments are delivered once and only new files are appended',()=>{
 const entries=[{type:'custom',customType:'pi-web:received-attachment',data:{id:'a',path:'/task/a.zip',name:'a.zip',size:10}}];
 const prefix=JSON.stringify(entries);assert.equal(pendingAttachments(entries).length,1);
 const prompt='新消息'+attachmentNotice(pendingAttachments(entries));assert.ok(prompt.startsWith('新消息'));assert.equal(JSON.stringify(entries),prefix);
 assert.equal(pendingAttachments([...entries,{type:'custom',customType:'pi-web:notified-attachments',data:{ids:['a']}}]).length,0);
});
test('delivery guide recognizes all mixed session entry types without changing history',()=>{
 const entries=[{type:'message',message:{role:'user',content:'旧消息'}}];const before=JSON.stringify(entries);assert.equal(needsDeliveryGuide(entries),true);
 assert.equal(needsDeliveryGuide([...entries,{type:'custom',customType:DELIVERY_NOTIFIED}]),false);assert.equal(JSON.stringify(entries),before);
});

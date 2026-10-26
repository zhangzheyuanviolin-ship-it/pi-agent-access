import test from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url);
const {countText,countRequest}=await jiti.import('./token-count.ts');
test('unknown cloud tokenizer is explicitly unavailable rather than a wide invented range',async()=>{const c=await countText('你好 world','unknown-cloud');assert.equal(c.tokens,undefined);assert.equal(c.chars,8);});
test('installed Qwen tokenizer and text template count without loading weights',{timeout:30000},async()=>{const c=await countText('你好','Qwen3.8-Flash-Next-Sushi-4bpw');assert.equal(typeof c.tokens,'number');const q=await countRequest({messages:[{role:'user',content:'你好'}]},'Qwen3.8-Flash-Next-Sushi-4bpw');assert.ok(q.tokens>c.tokens);const image=await countRequest({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AA'}}]}]},'Qwen3.8-Flash-Next-Sushi-4bpw');assert.equal(image.tokens,undefined);});

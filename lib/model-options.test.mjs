import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeModelOptions} from './model-options.ts';
const old = {provider:'mac-local-unified',modelId:'removed-mtplx',name:'old'};
const next = {provider:'mac-local-unified',modelId:'omlx',name:'video'};
const cloud = {provider:'cloud',modelId:'remote',name:'cloud'};
test('fresh local catalog removes stale configured and discovered entries without changing cloud entries',()=>{
 assert.deepEqual(mergeModelOptions([old,cloud],[old,next],[next]),[cloud,next]);
});
test('empty local catalog does not resurrect an uninstalled backend',()=>{
 assert.deepEqual(mergeModelOptions([old,cloud],[old],[]),[cloud]);
});
test('unavailable local configuration preserves existing choices and deduplicates discovery',()=>{
 assert.deepEqual(mergeModelOptions([cloud],[cloud],null),[cloud]);
});

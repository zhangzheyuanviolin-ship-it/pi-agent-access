import test from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{jsx:{runtime:'automatic'},tsconfigPaths:true});
const React=await jiti.import('react');const {renderToStaticMarkup}=await jiti.import('react-dom/server');
const {I18nProvider}=await jiti.import('../hooks/useI18n.tsx');const {MarkdownBody}=await jiti.import('./MarkdownBody.tsx');const {MessageActions}=await jiti.import('./MessageActions.tsx');
function render(node){return renderToStaticMarkup(React.createElement(I18nProvider,null,node));}
test('link names preserve the title and announce local-file or browser activation',()=>{
 const html=render(React.createElement(MarkdownBody,{cwd:'/tmp/teaching',onOpenFile:()=>{}},'[课程报告](report.txt) 和 [教学网站](https://example.com)'));
 assert.match(html,/aria-label="课程报告 （文件链接，激活后打开，可在文件面板保存）"/);
 assert.match(html,/aria-label="教学网站 （链接，激活后在浏览器打开）"/);
 assert.match(html,/rel="noopener noreferrer"/);
});
test('message actions start collapsed and never perform speech or rollback while rendering',()=>{
 const html=render(React.createElement(MessageActions,{text:'教学内容',onCopy:()=>{throw Error('unexpected copy')},onRollback:()=>{throw Error('unexpected rollback')}}));
 assert.match(html,/aria-expanded="false"/);assert.match(html,/aria-haspopup="menu"/);assert.match(html,/>消息操作</);assert.doesNotMatch(html,/role="menu"/);
});

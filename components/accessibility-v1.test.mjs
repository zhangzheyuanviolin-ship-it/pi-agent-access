import test from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{jsx:{runtime:'automatic'},tsconfigPaths:true});
const React=await jiti.import('react');
const {renderToStaticMarkup}=await jiti.import('react-dom/server');
const {I18nProvider,useI18n}=await jiti.import('../hooks/useI18n.tsx');
const {ConfigField}=await jiti.import('./SettingsUi.tsx');
const {useFieldLabel}=await jiti.import('./FieldLabelContext.tsx');
function LocaleProbe(){const {locale,t}=useI18n();return React.createElement('div',{'data-locale':locale},t('common.settings'));}
test('local distribution starts in Chinese and an explicit English locale remains supported',()=>{
 assert.match(renderToStaticMarkup(React.createElement(I18nProvider,null,React.createElement(LocaleProbe))),/data-locale="zh-CN">设置/);
 assert.match(renderToStaticMarkup(React.createElement(I18nProvider,{initialLocale:'en'},React.createElement(LocaleProbe))),/data-locale="en">Settings/);
});
function CustomInput(){return React.createElement('input',{'aria-labelledby':useFieldLabel()});}
test('native and custom configuration fields reference distinct visible labels; explicit input names survive',()=>{
 const html=renderToStaticMarkup(React.createElement('div',null,
  React.createElement(ConfigField,{label:'服务地址'},React.createElement('input')),
  React.createElement(ConfigField,{label:'模型名称'},React.createElement(CustomInput)),
  React.createElement(ConfigField,{label:'请求头'},React.createElement('input',{'aria-label':'请求头名称'}))));
 const labels=[...html.matchAll(/<span id="([^"]+)" class="config-field-label">([^<]+)<\/span>/g)];
 assert.equal(labels.length,3);assert.notEqual(labels[0][1],labels[1][1]);
 for(const [,,name]of labels)assert.ok(['服务地址','模型名称','请求头'].includes(name));
 for(const [,id]of labels.slice(0,2))assert.ok(html.includes('<input aria-labelledby="'+id+'"'));
 assert.ok(html.includes('aria-label="请求头名称"'));
});

test('both macOS app identities declare an Apple Events purpose before Computer Use requests',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const file of ['../src-tauri/Info.plist','../desktop/server-helper-Info.plist']){
  const text=await readFile(new URL(file,import.meta.url),'utf8');
  assert.match(text,/<key>NSAppleEventsUsageDescription<\/key>\s*<string>[^<]+<\/string>/);
 }
});

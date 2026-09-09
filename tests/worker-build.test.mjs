import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { poolRuntimeStrings } from '../scripts/pool-runtime-strings.mjs';
describe('worker string pooling preserves JavaScript behavior',()=>{
 it('preserves public keys, accessors, optional access, method names, and JSON round trips',async()=>{
  const code=`const item={canonicalResourceIdentifier:'资源标识字符串',longPropertyName:'资源标识字符串',methodWithLongName(){return this.longPropertyName},get dynamicLongPropertyName(){return this.canonicalResourceIdentifier}};const list=[item.canonicalResourceIdentifier,item.longPropertyName,item.methodWithLongName(),item.methodWithLongName.name,item.dynamicLongPropertyName,item.canonicalResourceIdentifier,item.longPropertyName,item.longPropertyName,item?.longPropertyName];globalThis.result={list,keys:Object.keys(item),json:JSON.stringify(item),names:item.methodWithLongName.name};`;
  const compiled=await poolRuntimeStrings(code);expect(compiled.sharedStrings).toBeGreaterThan(0);
  const original={},processed={};runInNewContext(code,original);runInNewContext(compiled.code,processed);expect(JSON.stringify(processed.result)).toBe(JSON.stringify(original.result));
 });
 it('preserves prototype syntax, switch labels, short circuiting and Unicode',async()=>{
  const code=`let hits=0;const item={__proto__:null,veryLongProtocolKey:'中文响应字符串'};function get(){hits++;return item}const read=[get().veryLongProtocolKey,get().veryLongProtocolKey,item.veryLongProtocolKey,item.veryLongProtocolKey];let result;switch(read[0]){case'中文响应字符串':result='中文响应字符串';break;default:result='中文响应字符串'}globalThis.result=[hits,Object.getPrototypeOf(item),read,result];`;
  const compiled=await poolRuntimeStrings(code);const original={},processed={};runInNewContext(code,original);runInNewContext(compiled.code,processed);expect(JSON.stringify(processed.result)).toBe(JSON.stringify(original.result));
 });
 it('never captures pooled outer variables in serialized Chrome injection functions',async()=>{
  const code=`function injected(document){return document.veryLongPropertyName+document.veryLongPropertyName+document.veryLongPropertyName+document.veryLongPropertyName}const x={veryLongPropertyName:'repeated literal',veryLongSecondProperty:'repeated literal'};globalThis.result={f:injected,inline:()=>({veryLongPropertyName:'repeated literal'})};globalThis.chrome.scripting.executeScript({func:injected});globalThis.chrome.scripting.executeScript({func:()=>({veryLongPropertyName:'repeated literal',veryLongSecondProperty:'repeated literal'})});globalThis.read=[x.veryLongPropertyName,x.veryLongPropertyName,x.veryLongSecondProperty];`;
  const compiled=await poolRuntimeStrings(code);const serialized=[];
  const context={chrome:{scripting:{executeScript:({func})=>serialized.push(func.toString())}}};runInNewContext(compiled.code,context);
  expect(runInNewContext(`(${serialized[0]})({veryLongPropertyName:'x'})`)).toBe('xxxx');
  expect(JSON.stringify(runInNewContext(`(${serialized[1]})()`))).toBe(JSON.stringify({veryLongPropertyName:'repeated literal',veryLongSecondProperty:'repeated literal'}));
 });

});

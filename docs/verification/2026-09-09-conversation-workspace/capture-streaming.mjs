// Real stream client + chat hook, controlled local Port events. Never contacts AI.
const fs=await import('node:fs/promises'),p=(await taskSpace(8)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-conversation-workspace/';
await p.cdp('Emulation.setDeviceMetricsOverride',{width:400,height:640,deviceScaleFactor:1,mobile:false});
await p.goto('http://127.0.0.1:5173/floating.html?preview=1',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForSelector('.bookmark-row',{state:'visible',timeout:30000});
await p.evaluate(async()=>{const {previewMutable}=await import('/src/ui/sidepanel/preview-state.ts');previewMutable.aiSettings.apiKeyConfigured=true;window.__aarreQA={composer:document.querySelector('#bookmark-agent-prompt')};(await import('/src/lib/theme.ts')).applyTheme('light');});
await p.click('button[aria-label="更多操作"]');await p.click('[role="menuitem"]:has-text("设置")');await p.waitForSelector('.settings-field',{state:'visible'});await p.click('button[aria-label="关闭窗口"]');await p.waitForFunction(()=>!document.querySelector('.agent-connect-action'),undefined,{timeout:30000});

await p.evaluate(()=>{
 window.__aarreQA.streams=[];
 chrome.runtime.connect=()=>{
   const messages=new Set(),disconnects=new Set();
   const port={onMessage:{addListener:f=>messages.add(f),removeListener:f=>messages.delete(f)},onDisconnect:{addListener:f=>disconnects.add(f),removeListener:f=>disconnects.delete(f)},postMessage:request=>{port.request=request;},disconnect:()=>{port.disconnected=true;for(const f of disconnects)f();},emit:event=>{for(const f of messages)f(event);},listeners:()=>messages.size+disconnects.size};
   window.__aarreQA.streams.push(port);return port;
 };
});
await p.fill('#bookmark-agent-prompt','逐步整理我的设计收藏');await p.keyboard.press('Enter');
await p.waitForFunction(()=>window.__aarreQA.streams.length===1,undefined,{timeout:30000});
await p.evaluate(()=>window.__aarreQA.streams[0].emit({type:'delta',text:'这是一段本地流式界面验收内容。'}));
await p.waitForFunction(()=>document.querySelector('.agent-markdown')?.textContent.includes('流式界面验收'),undefined,{timeout:30000});
await p.screenshot({path:out+'final/streaming-partial-light.png'});
const partial=await p.evaluate(()=>({sameComposer:window.__aarreQA.composer===document.querySelector('#bookmark-agent-prompt'),stop:!!document.querySelector('button[aria-label="停止 AI 对话"]'),text:document.querySelector('.agent-markdown').textContent}));
await p.evaluate(()=>window.__aarreQA.streams[0].emit({type:'delta',text:'\n\n第二段已增量显示，输入框保持原位。'}));
await p.waitForFunction(()=>document.querySelector('.agent-markdown')?.textContent.includes('第二段'),undefined,{timeout:10000});
await p.evaluate(()=>window.__aarreQA.streams[0].emit({type:'done',response:{answer:'这是一段本地流式界面验收内容。\n\n第二段已增量显示，输入框保持原位。',sources:[],actions:[{id:'qa-folder',type:'create_folder',label:'新建设计参考文件夹',description:'本地 QA 提案，不操作真实 Chrome 收藏。',title:'QA 设计参考',parentId:'preview-root',destructive:false,status:'pending',selected:true}]}}));
await p.waitForFunction(()=>!document.querySelector('#bookmark-agent-prompt').disabled,undefined,{timeout:10000});
await p.screenshot({path:out+'final/streaming-actions-light.png'});
const done=await p.evaluate(()=>({sameComposer:window.__aarreQA.composer===document.querySelector('#bookmark-agent-prompt'),enabled:!document.querySelector('#bookmark-agent-prompt').disabled,listeners:window.__aarreQA.streams[0].listeners(),disconnected:window.__aarreQA.streams[0].disconnected,pageWidth:document.documentElement.scrollWidth}));
await fs.writeFile(out+'streaming-flow.json',JSON.stringify({fixture:'Local Port replay; real stream client and UI; proposal not executed',partial,done},null,2));console.log({partial,done});console.log(await p.snapshot());

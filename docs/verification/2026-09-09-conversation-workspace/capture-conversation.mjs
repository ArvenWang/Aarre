// Runs the real UI and chat hook with an explicitly isolated, local service response.
// No provider request, API key or native Chrome mutation is used by this replay.
const fs=await import('node:fs/promises'),p=(await taskSpace(8)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-conversation-workspace/';
const results={fixture:'DEV local QA transport; real composer, chat hook, persistence and UI. No external AI request.',steps:[]};
const shot=async name=>{await p.evaluate(async()=>{await document.fonts.ready;await Promise.race([Promise.allSettled(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)),new Promise(r=>setTimeout(r,1000))]);});await p.screenshot({path:out+'final/'+name+'.png'});};
const theme=async mode=>p.evaluate(async m=>(await import('/src/lib/theme.ts')).applyTheme(m),mode);
await p.goto('http://127.0.0.1:5173/floating.html?preview=1',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForSelector('.bookmark-row',{timeout:30000});
if(await p.evaluate(()=>!!document.querySelector('.native-dialog'))) { await p.click('.native-dialog button[aria-label="关闭"]'); await p.waitForFunction(()=>!document.querySelector('.native-dialog'),undefined,{timeout:10000}); }
await p.cdp('Emulation.setDeviceMetricsOverride',{width:400,height:640,deviceScaleFactor:1,mobile:false});await theme('light');
await p.evaluate(async()=>{
 const {previewMutable}=await import('/src/ui/sidepanel/preview-state.ts');previewMutable.aiSettings.apiKeyConfigured=true;
 const send=chrome.runtime.sendMessage.bind(chrome.runtime);
 window.__aarreQA={requests:[],pending:[],composer:document.querySelector('#bookmark-agent-prompt')};
 chrome.runtime.sendMessage=async request=>{
   if(request.type==='ASK_BOOKMARK_AGENT'){window.__aarreQA.requests.push(request);return new Promise(resolve=>window.__aarreQA.pending.push(resolve));}
   if(request.type==='CANCEL_BOOKMARK_AGENT'){window.__aarreQA.requests.push(request);return{ok:true,data:{cancelled:true}};}
   return send(request);
 };
});
// Closing the actual settings window refreshes configuration without remounting the composer.
await p.click('button[aria-label="更多操作"]');await p.click('[role="menuitem"]:has-text("设置")');await p.waitForSelector('.settings-field',{state:'visible'});await p.click('button[aria-label="关闭窗口"]');
await p.waitForFunction(()=>!document.querySelector('.agent-connect-action'),undefined,{timeout:30000});
await p.fill('#bookmark-agent-prompt','帮我找找收藏里的设计资料，并给出整理建议');await p.keyboard.press('Enter');
await p.waitForFunction(()=>window.__aarreQA.pending.length===1&&document.querySelector('.agent-chat-panel'),undefined,{timeout:30000});
await shot('conversation-sending-light');
results.steps.push(await p.evaluate(()=>({step:'submit',sameComposer:window.__aarreQA.composer===document.querySelector('#bookmark-agent-prompt'),tabs:document.querySelectorAll('.floating-shell [role=tab]').length,stop:!!document.querySelector('button[aria-label="停止 AI 对话"]'),queries:window.__aarreQA.requests.map(r=>r.query)})));
await p.evaluate(()=>{
 const answer='这是隔离的界面验收回答，未调用 AI 服务。\n\n## 从设计资料开始\n\n先回到你保存的 [Figma — 设计与创作](https://www.figma.com/)，查看原始设计和备注，再按用途整理。\n\n| 资料名称 | 主要用途 | 下一步操作 | 原始来源 |\n| --- | --- | --- | --- |\n| 无障碍设计指南与组件规范 | 检查焦点、字号及键盘访问 | 对照实际页面逐项验证 | documentation.example.com/accessibility |\n| 响应式网页和布局参考 | 核对窄窗口及长文本展示 | 在多种窗口尺寸下检查 | documentation.example.com/responsive |\n\n```json\n{ "title": "较长的单行代码，用于验证横向滚动只在代码区域内发生", "source": "https://documentation.example.com/long-path/design-systems/scrollbars" }\n```\n\n'+Array.from({length:5},(_,i)=>`### ${i+1}. 检查收藏内容\n\n确认标题、网址、备注和文件夹的位置。保留原始来源，方便随时回到网页。`).join('\n\n');
 window.__aarreQA.pending.shift()({ok:true,data:{answer,thinking:[],sources:[{resourceKey:'qa-figma',title:'Figma — 设计与创作',url:'https://www.figma.com/',siteName:'Figma',faviconUrl:''}],actions:[]}});
});
await p.waitForSelector('.agent-markdown table',{state:'visible',timeout:30000});
await p.evaluate(()=>document.querySelector('.agent-thread').scrollTo(0,0));
results.steps.push(await p.evaluate(()=>({step:'response',sameComposer:window.__aarreQA.composer===document.querySelector('#bookmark-agent-prompt'),enabled:!document.querySelector('#bookmark-agent-prompt').disabled})));
for(const width of [400,320,560]){await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:640,deviceScaleFactor:1,mobile:false});for(const mode of ['light','dark']){await theme(mode);await p.evaluate(()=>document.querySelector('.agent-thread').scrollTo(0,0));await shot(`conversation-${width}-${mode}`);results.steps.push(await p.evaluate(()=>({step:'geometry',theme:document.documentElement.dataset.theme,width:innerWidth,pageWidth:document.documentElement.scrollWidth,threadWidth:document.querySelector('.agent-thread').clientWidth,threadScrollWidth:document.querySelector('.agent-thread').scrollWidth,composer:document.querySelector('.agent-composer').getBoundingClientRect().toJSON(),blocks:[...document.querySelectorAll('.markdown-scroll-frame .scroll-area-viewport')].map(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,left:e.scrollLeft}))})));}}
await p.cdp('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:1,mobile:false});
await p.evaluate(()=>{const e=document.querySelector('.markdown-scroll-frame');e.scrollIntoView({block:'center'});e.querySelector('[role=scrollbar]').focus();});await p.keyboard.press('End');await shot('conversation-table-end-dark');
results.steps.push(await p.evaluate(()=>({step:'table-end',left:document.querySelector('.markdown-scroll-frame .scroll-area-viewport').scrollLeft,composerBottom:document.querySelector('.agent-composer').getBoundingClientRect().bottom})));
await p.fill('#bookmark-agent-prompt','继续按用途分类');await p.click('button[aria-label="返回收藏列表"]');
results.steps.push(await p.evaluate(()=>({step:'back-to-library',draft:document.querySelector('#bookmark-agent-prompt').value,sameComposer:window.__aarreQA.composer===document.querySelector('#bookmark-agent-prompt')})));
await p.click('.agent-composer-context button');await p.click('button[aria-label="发送给 Aarre"]');await p.waitForFunction(()=>window.__aarreQA.pending.length===1,undefined,{timeout:30000});
results.steps.push(await p.evaluate(()=>({step:'follow-up',historyMessages:window.__aarreQA.requests.filter(r=>r.type==='ASK_BOOKMARK_AGENT').at(-1).history.length})));
await p.click('button[aria-label="停止 AI 对话"]');await p.evaluate(()=>window.__aarreQA.pending.shift()({ok:true,data:{answer:'LATE_ANSWER_MUST_NOT_APPEAR',sources:[],actions:[]}}));
await p.waitForFunction(()=>!document.querySelector('#bookmark-agent-prompt').disabled,undefined,{timeout:30000});await shot('conversation-stopped-dark');
results.steps.push(await p.evaluate(()=>({step:'stop',cancelRequest:window.__aarreQA.requests.some(r=>r.type==='CANCEL_BOOKMARK_AGENT'),lateTextVisible:document.body.textContent.includes('LATE_ANSWER_MUST_NOT_APPEAR')})));
await p.click('button[aria-label="更多操作"]');await p.click('[role="menuitem"]:has-text("历史会话")');await p.waitForSelector('.agent-history-open',{state:'visible'});await shot('history-dark');
await theme('light');await shot('history-light');
await p.click('.agent-history-open');await p.waitForSelector('.agent-chat-panel',{state:'visible'});
results.steps.push(await p.evaluate(()=>({step:'history-open',dialogs:document.querySelectorAll('[role=dialog]').length,conversation:!!document.querySelector('.agent-chat-panel'),composer:!!document.querySelector('#bookmark-agent-prompt')})));
await p.click('button[aria-label="更多操作"]');await p.click('[role="menuitem"]:has-text("新会话")');await p.waitForSelector('.bookmark-row',{state:'visible'});
results.steps.push(await p.evaluate(()=>({step:'new-conversation',draft:document.querySelector('#bookmark-agent-prompt').value,sameComposer:window.__aarreQA.composer===document.querySelector('#bookmark-agent-prompt'),chat:!!document.querySelector('.agent-chat-panel')})));
await fs.writeFile(out+'conversation-flow.json',JSON.stringify(results,null,2));console.log(results);console.log(await p.snapshot());

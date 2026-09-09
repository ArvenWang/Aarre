// Run with ego-browser nodejs. DEV fixture only; no Chrome bookmark/provider writes.
const fs=await import('node:fs/promises'),p=(await taskSpace(8)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-conversation-workspace/';
const metrics=[];
const vp=async width=>p.cdp('Emulation.setDeviceMetricsOverride',{width,height:640,deviceScaleFactor:1,mobile:false});
const theme=async mode=>p.evaluate(async m=>(await import('/src/lib/theme.ts')).applyTheme(m),mode);
const shot=async name=>{await p.evaluate(async()=>{await document.fonts.ready;await Promise.race([Promise.allSettled(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)),new Promise(r=>setTimeout(r,1000))]);});await p.screenshot({path:out+'final/'+name+'.png'});};
const measure=async name=>{metrics.push(await p.evaluate(name=>{
 const b=e=>e?.getBoundingClientRect().toJSON(),vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(e).visibility!=='hidden';};
 return {name,w:innerWidth,pageWidth:document.documentElement.scrollWidth,composer:b(document.querySelector('.agent-composer')),tabs:document.querySelectorAll('.floating-shell [role=tab]').length,
 selects:[...document.querySelectorAll('.aarre-select-trigger')].filter(vis).map(e=>{const r=e.getBoundingClientRect(),v=e.querySelector('.select__value')?.getBoundingClientRect(),i=e.querySelector('.select__indicator')?.getBoundingClientRect();return{height:r.height,valueCenterOffset:v?(v.top+v.height/2)-(r.top+r.height/2):null,arrowInset:i?r.right-i.right-parseFloat(getComputedStyle(e).borderRightWidth):null};}),
 selectedOptions:[...document.querySelectorAll('.aarre-select-item[data-selected]')].map(e=>{const a=e.getBoundingClientRect(),i=e.querySelector('.list-box-item__indicator').getBoundingClientRect();return{centerOffset:i.top+i.height/2-a.top-a.height/2};}),
 thumbs:[...document.querySelectorAll('.switch__thumb')].map(e=>getComputedStyle(e).backgroundColor),
 scrollers:[...document.querySelectorAll('*')].filter(e=>vis(e)&&e.clientHeight>0&&((/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1)||(/auto|scroll/.test(getComputedStyle(e).overflowX)&&e.scrollWidth>e.clientWidth+1))).map(e=>({class:e.className,width:e.clientWidth,scrollWidth:e.scrollWidth,native:getComputedStyle(e).scrollbarWidth,bars:[...document.querySelectorAll('[role=scrollbar]')].filter(b=>b.getAttribute('aria-controls')===e.id).length}))};
},name));await fs.writeFile(out+'menu-geometry.json',JSON.stringify(metrics,null,2));};
await p.goto('http://127.0.0.1:5173/floating.html?preview=1',{waitUntil:'domcontentloaded',timeout:30000});
await p.waitForSelector('.bookmark-row',{timeout:30000});
if(await p.evaluate(()=>!!document.querySelector('.native-dialog'))) { await p.click('.native-dialog button[aria-label="关闭"]'); await p.waitForFunction(()=>!document.querySelector('.native-dialog'),undefined,{timeout:10000}); }
await p.fill('#bookmark-agent-prompt','');
for(const w of [320,400,560]){await vp(w);for(const m of ['light','dark']){await theme(m);await shot(`menu-${w}-${m}`);await measure(`menu-${w}-${m}`);}}
await vp(400);await p.click('button[aria-label="更多操作"]');await p.waitForSelector('[role=menu]',{state:'visible'});await shot('more-dark');
await p.click('[role="menuitem"]:has-text("设置")');await p.waitForSelector('.settings-model-select-trigger',{state:'visible',timeout:30000});
for(const w of [320,400]){await vp(w);for(const m of ['dark','light']){await theme(m);await shot(`settings-${w}-${m}`);await measure(`settings-${w}-${m}`);}}
for(const m of ['light','dark']){await theme(m);await p.click('.settings-model-select-trigger');await p.waitForSelector('.aarre-select-viewport',{state:'visible'});await shot(`select-${m}`);await measure(`select-${m}`);await p.keyboard.press('Escape');}
await p.click('button[aria-label="关闭窗口"]');await vp(320);
await p.hover('.bookmark-row:has(button[aria-label="编辑 Anthropic — AI 与自动化"])');await p.click('button[aria-label="编辑 Anthropic — AI 与自动化"]');await p.waitForSelector('.native-dialog-scroll',{state:'visible'});
await theme('light');await shot('editor-320-light');await measure('editor-320-light');
await p.fill('.native-dialog textarea',Array.from({length:35},(_,i)=>`${i+1}. 这是长备注排版检查，验证内容换行、文字间距和滚动条。`).join('\n'));
for(const m of ['light','dark']){await theme(m);await shot(`editor-note-320-${m}`);await measure(`editor-note-320-${m}`);}
await p.click('.editor-delete-action');
for(const m of ['dark','light']){await theme(m);await shot(`delete-320-${m}`);await measure(`delete-320-${m}`);}
await p.keyboard.press('Escape');await p.keyboard.press('Escape');
await fs.writeFile(out+'menu-geometry.json',JSON.stringify(metrics,null,2));
console.log({scenes:metrics.map(x=>x.name),missingBars:metrics.flatMap(x=>x.scrollers.filter(s=>!s.bars).map(s=>({scene:x.name,...s}))),overflows:metrics.filter(x=>x.pageWidth>x.w),selects:metrics.flatMap(x=>x.selects),selectedOptions:metrics.flatMap(x=>x.selectedOptions)});
console.log(await p.snapshot());

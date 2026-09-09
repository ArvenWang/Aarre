// Actual product components in DEV. No native bookmark, backup or cover job writes.
const fs=await import('node:fs/promises'),p=(await taskSpace(8)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-conversation-workspace/';
const results=[];
const theme=async mode=>p.evaluate(async m=>(await import('/src/lib/theme.ts')).applyTheme(m),mode);
const vp=async(width,height)=>p.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
async function capture(name){
 await p.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(e=>e.getBoundingClientRect().top<innerHeight&&e.getBoundingClientRect().bottom>0&&e.getBoundingClientRect().width>0).map(e=>e.decode().catch(()=>{})));await Promise.race([Promise.allSettled(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)),new Promise(r=>setTimeout(r,1000))]);});
 await p.screenshot({path:out+'final/'+name+'.png'});
 results.push(await p.evaluate(name=>{
 const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&!e.closest('[aria-hidden=true]');};
 const b=e=>e?.getBoundingClientRect().toJSON();
 const footer=document.querySelector('.library-card-editor-confirm,.library-card-editor-actions');
 return{name,width:innerWidth,pageWidth:document.documentElement.scrollWidth,dialogs:document.querySelectorAll('[role=dialog]').length,themeGroup:b(document.querySelector('.manager-utilities')),footer:b(footer),footerButtons:footer?[...footer.querySelectorAll('button')].map(e=>({text:e.textContent,box:b(e)})):[],
 controls:[...document.querySelectorAll('.library-search,.library-search .fluid-input,.library-tabs,.library-tabs button,.snapshot-backfill-trigger,.aarre-select-trigger,.fluid-input:focus,.fluid-textarea:focus')].filter(vis).map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),i=e.querySelector('.select__indicator');return{class:e.className,height:r.height,font:s.fontSize,radius:s.borderRadius,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight,border:s.borderWidth,shadow:s.boxShadow,outline:s.outlineWidth,outlineOffset:s.outlineOffset,arrowInset:i?r.right-i.getBoundingClientRect().right-parseFloat(s.borderRightWidth):null};}),
 scrollers:[...document.querySelectorAll('*')].filter(e=>vis(e)&&e.clientHeight>0&&((/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1)||(/auto|scroll/.test(getComputedStyle(e).overflowX)&&e.scrollWidth>e.clientWidth+1))).map(e=>({class:e.className,width:e.clientWidth,scrollWidth:e.scrollWidth,native:getComputedStyle(e).scrollbarWidth,bars:[...document.querySelectorAll('[role=scrollbar]')].filter(b=>b.getAttribute('aria-controls')===e.id).length}))};
 },name));await fs.writeFile(out+'manager-geometry.json',JSON.stringify(results,null,2));
}
await p.goto('http://127.0.0.1:5173/manager.html',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForSelector('.library-masonry',{timeout:30000});
for(const [width,height] of [[1280,900],[420,820],[320,640]]){await vp(width,height);for(const mode of ['light','dark']){await theme(mode);await capture(`manager-${width}-${mode}`);}}
await vp(1280,900);
for(const view of ['organize','report','topics','resurface']){await p.click(`.manager-view-tabs [data-key="${view}"]`);await p.waitForSelector(`.manager-view[data-view="${view}"]`,{state:'visible'});await theme('light');await capture(`manager-${view}-light`);if(view==='report'){await theme('dark');await capture('manager-report-dark');}}
await p.click('.manager-view-tabs [data-key="library"]');await p.waitForSelector('.library-masonry',{state:'visible'});
await vp(420,820);await theme('light');await p.click('.library-search input');await capture('manager-search-focus-light');
await p.click('.aarre-select-trigger[aria-label="按 Chrome 书签文件夹筛选"]');await p.waitForSelector('.aarre-select-viewport',{state:'visible'});await capture('manager-filter-light');await p.keyboard.press('Escape');
await p.click('.snapshot-backfill-trigger');await p.waitForSelector('.snapshot-backfill-dialog',{state:'visible'});await capture('manager-cover-dialog-light');await p.keyboard.press('Escape');
await p.click('button[aria-label="收藏库设置"]');await p.waitForSelector('.manager-utility-dialog .settings-field',{state:'visible',timeout:30000});await capture('manager-settings-light');await theme('dark');await capture('manager-settings-dark');await p.keyboard.press('Escape');
await p.hover('.library-card:has(button[aria-label="编辑 Anthropic — AI 与自动化"])');await p.click('.library-card-editor-trigger[aria-label="编辑 Anthropic — AI 与自动化"]');await p.waitForSelector('.library-card-editor-body',{state:'visible'});
await capture('manager-editor-dark');await theme('light');await capture('manager-editor-light');
await p.click('.library-card-editor-delete');await p.waitForSelector('.library-card-editor-confirm',{state:'visible'});await capture('manager-delete-420-light');
await vp(320,640);await theme('dark');await capture('manager-delete-320-dark');await theme('light');await capture('manager-delete-320-light');
await p.keyboard.press('Escape');await p.waitForSelector('.library-card-editor-actions',{state:'visible'});await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('[role=dialog]'),undefined,{timeout:10000});
console.log({scenes:results.length,overflows:results.filter(x=>x.pageWidth>x.width),missingBars:results.flatMap(x=>x.scrollers.filter(s=>!s.bars).map(s=>({name:x.name,...s}))),deleteEscapeLayers:true});console.log(await p.snapshot());

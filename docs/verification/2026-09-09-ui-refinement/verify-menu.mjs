// DEV visual/interaction evidence only; does not operate the user's Chrome bookmarks.
const fs=await import('node:fs/promises'),p=(await taskSpace(6)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-ui-refinement/';
const metrics=[];
const viewport=async(width,height=640)=>{await p.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});};
const theme=async(mode)=>p.evaluate(async mode=>(await import('/src/lib/theme.ts')).applyTheme(mode),mode);
const shot=async name=>{await p.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().duration!=='auto'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished));});await p.screenshot({path:out+'final/'+name+'.png',fullPage:false});};
const measure=async name=>metrics.push(await p.evaluate(name=>{
 const r=e=>e.getBoundingClientRect(), visible=e=>{const b=r(e);return b.width&&b.height&&b.bottom>0&&b.top<innerHeight&&getComputedStyle(e).visibility!=='hidden';};
 return{name,viewport:{w:innerWidth,h:innerHeight},pageWidth:document.documentElement.scrollWidth,
 controls:[...document.querySelectorAll('.aarre-select-trigger,.fluid-input,.aarre-button')].filter(visible).filter(e=>!e.closest('.bookmark-row')).map(e=>{const a=e.querySelector('.select__indicator'),b=r(e),s=getComputedStyle(e);return{label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,40),h:b.height,font:s.fontSize,left:s.paddingLeft,right:s.paddingRight,arrowInset:a?b.right-r(a).right-parseFloat(s.borderRightWidth):null,valueFont:e.querySelector('.select__value')?getComputedStyle(e.querySelector('.select__value')).fontSize:null};}),
 scrollers:[...document.querySelectorAll('*')].filter(e=>visible(e)&&e.clientHeight>0&&((/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1)||(/auto|scroll/.test(getComputedStyle(e).overflowX)&&e.scrollWidth>e.clientWidth+1))).map(e=>({class:e.className,id:e.id,native:getComputedStyle(e).scrollbarWidth,barCount:[...document.querySelectorAll('[role=scrollbar]')].filter(b=>b.getAttribute('aria-controls')===e.id).length}))};
},name));
if(await p.evaluate(()=>!!document.querySelector('.native-dialog')))await p.keyboard.press('Escape');
await p.click('loc=role:tab[name="收藏"]');
for(const width of [320,400,560]){
 await viewport(width);await theme('light');await shot('menu-'+width+'-light');await measure('menu-'+width+'-light');
}
await viewport(400);await theme('dark');await shot('menu-dark');await measure('menu-dark');
await p.click('loc=role:tab[name="设置"]');await p.waitForSelector('.settings-page-content',{timeout:30000});
await shot('settings-dark');await measure('settings-dark');
await p.click('loc=css:.settings-model-select-trigger');await p.waitForSelector('.aarre-select-viewport',{timeout:30000});await shot('select-dark');await measure('select-dark');
await p.keyboard.press('Escape');await theme('light');await shot('settings-light');
await p.click('loc=css:.settings-model-select-trigger');await p.waitForSelector('.aarre-select-viewport',{timeout:30000});await shot('select-light');await measure('select-light');
await p.keyboard.press('Escape');await p.click('loc=role:tab[name="AI"]');await p.waitForSelector('.agent-chat-panel',{timeout:30000});await shot('ai-empty-light');await measure('ai-empty-light');
await theme('dark');await shot('ai-empty-dark');
await theme('light');await p.click('loc=role:tab[name="收藏"]');
await p.hover('loc=css:.bookmark-row:has(button[aria-label="编辑 Anthropic — AI 与自动化"])');
await p.click('loc=role:button[name="编辑 Anthropic — AI 与自动化"]');await p.waitForSelector('.native-dialog-scroll',{timeout:30000});
await viewport(320);await shot('editor-320-light');await measure('editor-320-light');
await p.click('loc=css:.editor-select-trigger');await p.waitForSelector('.aarre-select-viewport',{timeout:30000});await shot('folder-320-light');await measure('folder-320-light');
await p.keyboard.press('End');await p.keyboard.press('Escape');
await p.fill('loc=css:.native-dialog textarea',Array.from({length:35},(_,i)=>`${i+1}. 这是用于检验长备注滚动、内边距与窄窗排版的中文测试内容。`).join('\n'));
await shot('editor-note-320-light');await measure('editor-note-320-light');
await theme('dark');await shot('editor-note-320-dark');await measure('editor-note-320-dark');
await p.keyboard.press('Escape');
await fs.writeFile(out+'menu-geometry.json',JSON.stringify(metrics,null,2));console.log({scenes:metrics.map(m=>m.name),missingBars:metrics.flatMap(m=>m.scrollers.filter(s=>!s.barCount).map(s=>({scene:m.name,...s})))});

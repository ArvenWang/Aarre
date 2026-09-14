// Real shared components, isolated DEV collection; no installed Chrome claims.
const fs=await import('node:fs/promises'),p=(await taskSpace(6)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-ui-refinement/';
const measurements=[];
async function capture(name){
 await p.evaluate(async()=>{await document.fonts.ready;await Promise.race([Promise.allSettled(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().duration!=='auto'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)),new Promise(r=>setTimeout(r,1000))]);});
 await p.screenshot({path:out+'final/'+name+'.png'});
 measurements.push(await p.evaluate(name=>{
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).opacity!=='0'&&!e.closest('[aria-hidden="true"]');};
 const scrollers=[...document.querySelectorAll('*')].filter(e=>visible(e)&&e.clientHeight>0&&((/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1)||(/auto|scroll/.test(getComputedStyle(e).overflowX)&&e.scrollWidth>e.clientWidth+1)));
 return {name,viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth,scrollers:scrollers.map(e=>({class:e.className,id:e.id,width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight,native:getComputedStyle(e).scrollbarWidth,bars:[...document.querySelectorAll('[role=scrollbar]')].filter(b=>b.getAttribute('aria-controls')===e.id).length})),selects:[...document.querySelectorAll('.aarre-select-trigger')].filter(visible).map(e=>{const a=e.querySelector('.select__indicator'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return{label:e.getAttribute('aria-label'),font:s.fontSize,height:r.height,arrowInset:a?r.right-a.getBoundingClientRect().right-parseFloat(s.borderRightWidth):null};})};
 },name));
 await fs.writeFile(out+'manager-geometry.json',JSON.stringify(measurements,null,2));
}
const theme=mode=>p.evaluate(async mode=>(await import('/src/lib/theme.ts')).applyTheme(mode),mode);
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await p.goto('http://127.0.0.1:5173/manager.html',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForSelector('.library-masonry',{timeout:30000});
for(const view of ['library','organize','report','topics','resurface']){
 await p.click(`loc=css:.manager-view-tabs [data-key="${view}"]`);
 await p.waitForSelector(`.manager-view[data-view="${view}"]`,{timeout:30000});
 await theme('light');await capture('manager-'+view+'-light');
 await theme('dark');await capture('manager-'+view+'-dark');
}
await p.click('loc=css:.manager-view-tabs [data-key="library"]');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:420,height:820,deviceScaleFactor:1,mobile:false});
await theme('light');await capture('manager-420-light');
await p.click('loc=css:.aarre-select-trigger[aria-label="按 Chrome 书签文件夹筛选"]');
await p.waitForSelector('.aarre-select-viewport',{timeout:30000});await capture('manager-filter-420-light');
await p.keyboard.press('Escape');
await p.click('loc=role:button[name="收藏库设置"]');
await p.waitForSelector('.manager-utility-dialog .settings-page-content',{timeout:30000});await capture('manager-settings-420-light');
await theme('dark');await capture('manager-settings-420-dark');
await p.keyboard.press('Escape');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:1,mobile:false});
await p.evaluate(()=>{const id=document.querySelector('.manager-view-tabs').id;[...document.querySelectorAll('[role=scrollbar]')].find(e=>e.getAttribute('aria-controls')===id).focus();});
await p.keyboard.press('End');await capture('manager-nav-320-dark');
await fs.writeFile(out+'manager-geometry.json',JSON.stringify(measurements,null,2));
console.log({scenes:measurements.length,missingBars:measurements.flatMap(m=>m.scrollers.filter(s=>!s.bars).map(s=>({scene:m.name,...s}))),pageOverflow:measurements.filter(m=>m.pageWidth>m.viewport.width)});

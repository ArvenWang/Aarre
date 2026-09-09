// Additional overflow surfaces in real local UI; no export, upload, or AI call.
const fs=await import('node:fs/promises'),p=(await taskSpace(6)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-ui-refinement/';
const metrics=await fs.readFile(out+'secondary-geometry.json','utf8').then(JSON.parse).catch(()=>[]);
const theme=mode=>p.evaluate(async mode=>(await import('/src/lib/theme.ts')).applyTheme(mode),mode);
async function shot(name){
 await p.evaluate(async()=>{await document.fonts.ready;await Promise.race([Promise.allSettled(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().duration!=='auto'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)),new Promise(r=>setTimeout(r,1000))]);});
 await p.screenshot({path:out+'final/'+name+'.png'});
 metrics.splice(0,metrics.length,...metrics.filter(m=>m.name!==name));
 metrics.push(await p.evaluate(name=>({name,viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth,documentTop:document.scrollingElement.scrollTop,dialogCount:document.querySelectorAll('[role=dialog]').length,bars:[...document.querySelectorAll('[role=scrollbar]')].map(b=>({label:b.getAttribute('aria-label'),controls:b.getAttribute('aria-controls'),orientation:b.getAttribute('aria-orientation'),value:b.getAttribute('aria-valuenow'),max:b.getAttribute('aria-valuemax')}))}),name));
 await fs.writeFile(out+'secondary-geometry.json',JSON.stringify(metrics,null,2));
}
await p.cdp('Emulation.setDeviceMetricsOverride',{width:400,height:640,deviceScaleFactor:1,mobile:false});
await p.goto('http://127.0.0.1:5173/privacy.html',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForSelector('.privacy-shell',{timeout:30000});
await theme('light');await shot('privacy-light');
await theme('dark');
await p.evaluate(()=>document.querySelector('.floating-scrollbars-document [role=scrollbar]').focus());
await p.keyboard.press('End');await shot('privacy-end-dark');
if(!await p.evaluate(()=>document.scrollingElement.scrollTop>0))throw new Error('Document keyboard scroll failed');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:1,mobile:false});
await p.goto('http://127.0.0.1:5173/floating.html?preview=1&onboarding=1',{waitUntil:'domcontentloaded',timeout:30000});
await p.waitForSelector('.onboarding-panel',{timeout:30000});await theme('light');await shot('onboarding-320-light');
try { await p.click('loc=css:.onboarding-card > .aarre-button--primary'); }
catch (error) { if(!await p.evaluate(()=>!!document.querySelector('.onboarding-provider-form'))) throw error; }
await p.waitForSelector('.onboarding-provider-form input[type="password"]',{timeout:30000});await shot('onboarding-provider-320-light');
await theme('dark');await shot('onboarding-provider-320-dark');
await p.goto('http://127.0.0.1:5173/manager.html?archive=1',{waitUntil:'domcontentloaded',timeout:30000});
await p.waitForSelector('.archive-controls',{timeout:30000});await shot('archive-320-dark');
await theme('light');await shot('archive-320-light');
await p.keyboard.press('Escape');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:420,height:820,deviceScaleFactor:1,mobile:false});
await p.click('loc=role:button[name="收藏库设置"]');await p.waitForSelector('.manager-utility-dialog .settings-field',{timeout:30000});
await shot('manager-settings-420-light');await theme('dark');await shot('manager-settings-420-dark');
const fields=await p.evaluate(()=>[...document.querySelectorAll('.manager-utility-dialog .settings-field')].map(e=>{const label=e.querySelector('span'),input=e.querySelector('button,input');return {display:getComputedStyle(e).display,labelBottom:label.getBoundingClientRect().bottom,controlTop:input.getBoundingClientRect().top,controlWidth:input.getBoundingClientRect().width,fieldWidth:e.getBoundingClientRect().width};}));
if(fields.some(f=>f.display!=='grid'||f.controlTop<f.labelBottom+7||Math.abs(f.controlWidth-f.fieldWidth)>1))throw new Error('Shared settings field spacing failed');
await fs.writeFile(out+'shared-settings-fields.json',JSON.stringify(fields,null,2));
await p.keyboard.press('Escape');
await p.click('loc=css:.snapshot-backfill-trigger');await p.waitForSelector('.snapshot-backfill-dialog',{timeout:30000});
await shot('snapshot-confirm-420-dark');await theme('light');await shot('snapshot-confirm-420-light');await p.keyboard.press('Escape');
await p.hover('loc=css:.library-card:has(button[aria-label="编辑 Anthropic — AI 与自动化"])');
await p.click('loc=css:.library-card-editor-trigger[aria-label="编辑 Anthropic — AI 与自动化"]');await p.waitForSelector('.library-card-editor-dialog',{timeout:30000});
await shot('manager-editor-420-light');await theme('dark');await shot('manager-editor-420-dark');await p.keyboard.press('Escape');
await p.goto('http://127.0.0.1:5173/floating.html?preview=1',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForSelector('.bookmark-row',{timeout:30000});
await p.cdp('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:1,mobile:false});await theme('light');
await p.hover('loc=css:.bookmark-row:has(button[aria-label="编辑 Anthropic — AI 与自动化"])');await p.click('loc=role:button[name="编辑 Anthropic — AI 与自动化"]');
await p.waitForSelector('.native-dialog-scroll',{timeout:30000});await shot('editor-320-light');
await p.click('loc=css:.editor-select-trigger');await p.waitForSelector('.aarre-select-viewport',{timeout:30000});await shot('folder-320-light');await p.keyboard.press('Escape');
await p.fill('loc=css:.native-dialog textarea',Array.from({length:35},(_,i)=>`${i+1}. 这是用于检验长备注滚动、内边距与窄窗排版的中文测试内容。`).join('\n'));
await shot('editor-note-320-light');await theme('dark');await shot('editor-note-320-dark');await p.keyboard.press('Escape');
await p.click('loc=role:tab[name="设置"]');await p.cdp('Emulation.setDeviceMetricsOverride',{width:400,height:640,deviceScaleFactor:1,mobile:false});
await p.waitForSelector('.settings-page-content',{timeout:30000});await shot('settings-dark');await theme('light');await shot('settings-light');
await fs.writeFile(out+'shared-settings-fields.json',JSON.stringify(fields,null,2));
await fs.writeFile(out+'secondary-geometry.json',JSON.stringify(metrics,null,2));console.log(metrics);

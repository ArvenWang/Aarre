const t=await taskSpace(5),p=t.page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09/final/';
const settle=()=>p.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().duration!=='auto'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
const shot=async(name,width=1440,height=1000)=>{await settle();await p.screenshot({fullPage:false,clip:{x:0,y:0,width,height},path:out+name+'.png'});};
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await p.goto('http://127.0.0.1:5173/manager.html?preview=1');await p.waitForFunction(()=>!!document.querySelector('.manager-theme-button'));
if(await p.evaluate(()=>document.documentElement.dataset.theme!=='light'))await p.click('loc=role:button[name="切换到日间模式"]');
for(const [view,label] of [['organize','整理提案'],['report','报告'],['topics','主题图谱'],['resurface','重新发现']]){
  await p.click('loc=role:tab[name*="'+label+'"]');
  await p.waitForFunction(view=>new URLSearchParams(location.search).get('view')===view&&!!document.querySelector('[role=tabpanel]')&&document.querySelector('[role=tabpanel]').textContent.length>200,view);
  if(view==='topics'){await p.waitForFunction(()=>document.querySelectorAll('.topic-directory-trigger').length===24);await p.press('loc=css:.topic-directory-trigger >> nth=0','Enter');}
  await shot('manager-'+view+'-light');
}
for(const theme of ['light','dark']){
  await p.goto('http://127.0.0.1:5173/manager.html?preview=1');await p.waitForFunction(()=>!!document.querySelector('.manager-theme-button'));
  if(await p.evaluate(theme=>document.documentElement.dataset.theme!==theme,theme))await p.click('loc=css:.manager-theme-button');
  await p.goto('http://127.0.0.1:5173/privacy.html');await p.waitForFunction(()=>!!document.querySelector('h1'));await shot('privacy-'+theme);
}
await p.cdp('Emulation.setDeviceMetricsOverride',{width:420,height:800,deviceScaleFactor:1,mobile:false});
await p.goto('http://127.0.0.1:5173/sidepanel.html?preview=1&onboarding=1');await p.waitForFunction(()=>!!document.querySelector('h1'));await shot('onboarding-dark',420,800);
console.log((await p.snapshot({scope:'full_page'})).slice(0,4500));

// Actual pointer drag and CSS fade. Only the animation is paused to photograph
// an intermediate frame; no production DOM, CSS, or data values are replaced.
const fs=await import('node:fs/promises'), p=(await taskSpace(8)).page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09-conversation-workspace/';
await p.cdp('Emulation.setDeviceMetricsOverride',{width:400,height:640,deviceScaleFactor:1,mobile:false});
await p.goto('http://127.0.0.1:5173/floating.html?preview=1',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForSelector('#bookmark-list',{state:'visible',timeout:30000});
await p.evaluate(async()=>{(await import('/src/lib/theme.ts')).applyTheme('light');document.querySelector('#bookmark-list').scrollTop=280;});
await p.mouse.move(386,300);
const start=await p.evaluate(()=>{const e=document.querySelector('[aria-controls="bookmark-list"]'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,scrollTop:document.querySelector('#bookmark-list').scrollTop,width:document.querySelector('#bookmark-list').clientWidth};});
await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(start.x,start.y+35);
await p.screenshot({path:out+'final/scroll-drag.png'});
const drag=await p.evaluate(()=>{const b=document.querySelector('[aria-controls="bookmark-list"]');return {scrollTop:document.querySelector('#bookmark-list').scrollTop,opacity:getComputedStyle(b).opacity,dragging:b.parentElement.dataset.dragging,thumbSize:getComputedStyle(b.querySelector('span')).width,hitSize:b.getBoundingClientRect().width};});
await p.evaluate(()=>{
 const thumb=document.querySelector('[aria-controls="bookmark-list"]');
 window.__aarreFade={};
 thumb.addEventListener('transitionrun',function capture(event){
   if(event.propertyName!=='opacity'||thumb.parentElement.dataset.active!=='false')return;
   const animation=thumb.getAnimations().find(a=>a.transitionProperty==='opacity');
   if(!animation)return;
   animation.pause();animation.currentTime=40;
   window.__aarreFade={animation,paused:true,duration:animation.effect.getTiming().duration,currentTime:40};
   thumb.removeEventListener('transitionrun',capture);
 });
});
await p.mouse.up();await p.mouse.move(20,20);
await p.waitForFunction(()=>window.__aarreFade?.paused,undefined,{timeout:30000});
await p.screenshot({path:out+'final/scroll-fading.png'});
const fading=await p.evaluate(()=>({opacity:getComputedStyle(document.querySelector('[aria-controls="bookmark-list"]')).opacity,duration:window.__aarreFade.duration,pausedAt:window.__aarreFade.currentTime}));
await p.evaluate(()=>window.__aarreFade.animation.play());
await p.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-controls="bookmark-list"]')).opacity==='0',undefined,{timeout:30000});
await p.screenshot({path:out+'final/scroll-idle.png'});
const idle=await p.evaluate(()=>{const e=document.querySelector('#bookmark-list'),b=document.querySelector('[aria-controls="bookmark-list"]');return {scrollTop:e.scrollTop,opacity:getComputedStyle(b).opacity,native:getComputedStyle(e).scrollbarWidth,trackBackground:getComputedStyle(b.parentElement).backgroundColor,clientWidth:e.clientWidth};});
if(!(drag.scrollTop>start.scrollTop&&drag.opacity==='1'&&Number(fading.opacity)>0&&Number(fading.opacity)<1&&idle.opacity==='0'&&start.width===idle.clientWidth))throw new Error('Scroll/fade acceptance failed');
await fs.writeFile(out+'scroll-drag.json',JSON.stringify({start,drag,fading,idle,method:'Actual pointer drag, real CSS fade paused at 40ms for middle screenshot, then resumed'},null,2));
console.log({start,drag,fading,idle});

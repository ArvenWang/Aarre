// Uses the existing Ego task space. DEV fixtures only; never a user's bookmark profile.
const fs=await import('node:fs/promises'),t=await taskSpace(5),p=t.page('p1');
const out='/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09/';
const frames=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const settle=async()=>{await p.evaluate(async()=>{const d=window.__aarreHarness?.frame?.document||document;await d.fonts.ready;await Promise.allSettled(d.getAnimations().filter(a=>a.effect?.getTiming().duration!=='auto'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished));});await frames();};
const shot=async(name,width=1440,height=1000)=>{await settle();await p.screenshot({fullPage:false,clip:{x:0,y:0,width,height},path:out+'final/'+name+'.png'});};
const viewport=async(width,height=1000)=>{await p.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await frames();};
await viewport(1440);await p.goto('http://127.0.0.1:5173/docs/verification/2026-09-09/host-harness.html');
await p.waitForSelector('loc=role:button[name="打开 Aarre 菜单"]');await shot('ball-collapsed-light');
await p.click('loc=role:button[name="打开 Aarre 菜单"]');await p.waitForFunction(()=>!!window.__aarreHarness.frame?.document.querySelector('#bookmark-list'));
const geometry=[];
for(const width of [360,420,1280,1440]){await viewport(width,width<500?640:1000);await settle();geometry.push(await p.evaluate(width=>{const w=window.__aarreHarness.frame,d=w.document,s=w.frameElement.getRootNode();const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};return{requestedWidth:width,viewport:{width:visualViewport.width,height:visualViewport.height},ball:rect(s.querySelector('.ball')),menu:rect(s.querySelector('.panel')),iframe:{width:d.documentElement.clientWidth,scrollWidth:d.documentElement.scrollWidth},tabs:rect(d.querySelector('.floating-nav')),alignment:[...d.querySelectorAll('.floating-nav [role=tab]')].map(e=>{const r=e.getBoundingClientRect(),s=e.querySelector('svg').getBoundingClientRect();return{label:e.textContent.trim(),iconToControlCenterY:Math.abs(s.y+s.height/2-r.y-r.height/2)};})};},width));}
await p.click('loc=role:button[name="收起 Aarre 菜单"]');
const corners=[];
for(const [name,edge,vertical] of [['top-left','left','top'],['top-right','right','top'],['bottom-left','left','bottom'],['bottom-right','right','bottom']]){
  const c=await p.evaluate(({edge,vertical})=>{const root=window.__aarreHarness.frame.frameElement.getRootNode(),r=root.querySelector('.ball').getBoundingClientRect();return{from:{x:r.x+26,y:r.y+26},to:{x:edge==='left'?38:visualViewport.width-38,y:vertical==='top'?38:visualViewport.height-38}};},{edge,vertical});
  await p.mouse.move(c.from.x,c.from.y);await p.mouse.down();await p.mouse.move((c.from.x+c.to.x)/2,(c.from.y+c.to.y)/2);await p.mouse.move(c.to.x,c.to.y);await p.mouse.up();await frames();
  const closed=await p.evaluate(()=>window.__aarreHarness.frame.frameElement.getRootNode().querySelector('.panel').hidden);
  if(name==='top-left'&&!closed)throw Error('Dragging a closed ball incorrectly opened its menu');
  if(closed)await p.click('loc=role:button[name="打开 Aarre 菜单"]');
  await shot('corner-'+name);
  corners.push(await p.evaluate(name=>{const s=window.__aarreHarness.frame.frameElement.getRootNode();const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};return{name,ball:rect(s.querySelector('.ball')),menu:rect(s.querySelector('.panel')),viewport:{width:visualViewport.width,height:visualViewport.height}};},name));
}
const grip=await p.evaluate(()=>{const r=window.__aarreHarness.frame.frameElement.getRootNode().querySelector('.resize').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
await p.mouse.move(grip.x,grip.y);await p.mouse.down();await p.mouse.move(grip.x-60,grip.y-80);await p.mouse.up();await frames();
const resized=await p.evaluate(()=>{const r=window.__aarreHarness.frame.frameElement.getRootNode().querySelector('.panel').getBoundingClientRect();return{width:r.width,height:r.height};});
if(resized.width!==460||resized.height!==680)throw Error('Pointer resize did not produce 460 x 680');
await shot('pointer-resize-light');
console.log({geometry,corners,resized});
await fs.writeFile(out+'narrow-geometry.json',JSON.stringify(geometry,null,2));
await fs.writeFile(out+'pointer-geometry.json',JSON.stringify({scope:'Production host in DEV harness, actual mouse pointer input',closedDragDidNotOpen:true,corners,resized},null,2));

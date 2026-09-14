// Floating dock acceptance using both packaged extensions in disposable Chrome.
// Visible Chrome is the default: headless OOPIF hit routing can differ at viewport edges.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const artifact = path.resolve(process.env.SUITE_ARTIFACT_DIR || 'work/verification-floating-dock');
await mkdir(artifact, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), 'nex-suite-'));
const nexPath = path.resolve(process.env.NEXALIGN_EXTENSION_PATH || '../LayerScope/dist'), aarrePath = path.resolve(process.env.AARRE_EXTENSION_PATH || 'dist');
const productPaths = Object.fromEntries(await Promise.all([['aarre','public/icons/icon.svg'],['nexalign','../LayerScope/src/assets/nexalign-icon-light.svg']].map(async ([app,file]) => [app, [...(await readFile(file,'utf8')).matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map(match=>match[1])])));
const report = { checks: [], errors: [], versions: {
  nexalign: JSON.parse(await readFile(path.join(nexPath, 'manifest.json'), 'utf8')).version_name,
  aarre: JSON.parse(await readFile(path.join(aarrePath, 'manifest.json'), 'utf8')).version,
} };
const check = (pass, name, evidence) => { report.checks.push({ pass: !!pass, name, evidence }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); assert.ok(pass, name); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer((request, response) => {
  if (request.url === '/held.js') {
    response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    response.flushHeaders(); return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>共享入口验收</title><style>body{padding:60px;background:#f3f4f7;font:16px/1.6 Arial}article{background:white;padding:32px;width:480px;border-radius:16px}h1{font-size:28px}button{padding:12px}</style><article><h1>两个应用，一个入口</h1><p>真实扩展与真实网页中的切换验证。</p><button>网页按钮</button></article>' + (request.url?.includes('pending=1') ? '<script src="/held.js"></script>' : '') + '</html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let context;
const deadline = setTimeout(() => { report.timeout = true; void context?.close(); }, 360_000);
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.SUITE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: process.env.SUITE_VERIFY_HEADLESS === '1', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, recordVideo: { dir: artifact, size: { width: 1280, height: 900 } }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
  });
  const browser = await context.browser().newBrowserCDPSession();
  report.browser = await browser.send('Browser.getVersion');
  const { id: aarreId } = await browser.send('Extensions.loadUnpacked', { path: aarrePath });
  const { id: nexId } = await browser.send('Extensions.loadUnpacked', { path: nexPath });
  report.ids = { aarreId, nexId };
  const source = context.pages()[0] || await context.newPage();
  source.on('pageerror', error => report.errors.push(error.stack || error.message));
  source.on('console', message => { if (message.type() === 'error' && message.location().url?.startsWith('chrome-extension://')) report.errors.push(message.text()); });
  await source.goto(url);
  const workerFor = async id => {
    let w = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${id}/`));
    if (!w) w = await context.waitForEvent('serviceworker', { predicate: w => w.url().startsWith(`chrome-extension://${id}/`) });
    return w;
  };
  const nex = await workerFor(nexId), aarre = await workerFor(aarreId);
  // Provision a real writable folder in this disposable Chrome profile. The
  // existing Aarre save flow selects user-created folders, not permanent roots.
  report.bookmarkFolder = await aarre.evaluate(async () => {
    const [root] = await chrome.bookmarks.getTree();
    const parent = root.children.find(node => node.id === '2') || root.children.find(node => !node.url && !node.unmodifiable);
    return chrome.bookmarks.create({parentId:parent.id,title:'共享入口验证'});
  });
  let nexAvailable = true;
  nex.on('close', () => { nexAvailable = false; });
  const tabs = await nex.evaluate(() => chrome.tabs.query({}));
  const tabId = tabs.find(tab => tab.url === url).id;
  const { targetInfos } = await browser.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }, { exclude: true }] });
  const target = targetInfos.find(item => item.type === 'tab' && item.url === url);
  const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.targetId });
  await browser.send('Browser.setWindowBounds', { windowId, bounds: { width: 1380, height: 1100 } });
  await browser.send('Extensions.triggerAction', { id: nexId, targetId: target.targetId });
  const state = () => source.evaluate(() => {
    const a = document.querySelector('aarre-floating-host[data-aarre-ui="floating-host"]');
    const n = document.querySelector('div[data-layerscope-canvas-toolbar][popover]');
    return { a: a && { ...a.dataset }, n: n && { ...n.dataset } };
  });
  const until = async (predicate, name, timeout = 20_000) => {
    const start = Date.now(); let result;
    while (Date.now() - start < timeout) { result = await predicate(); if (result) return result; await pause(60); }
    throw new Error(`${name}: ${JSON.stringify(await state())}`);
  };
  await until(async () => { const s = await state(); return s.a?.suitePaired === 'true' && s.n?.suitePaired === 'true'; }, '共享握手');
  check(true, '两只正式构建通过 Chrome 身份与同文档握手', await state());

  const attrs = node => Object.fromEntries(Array.from({ length: (node.attributes || []).length / 2 }, (_, i) => [node.attributes[i * 2], node.attributes[i * 2 + 1]]));
  async function inspect(selector, retried = false) {
    // Use the extension's debugger while it owns the source, otherwise a short read-only observation session.
    let observer;
    const sendOwned = (method, params = {}) => nex.evaluate(async ({ tabId, method, params }) => chrome.debugger.sendCommand({ tabId }, method, params), { tabId, method, params });
    let send = sendOwned;
    try { if (!nexAvailable) throw new Error('Extension was unloaded'); await send('DOM.enable'); } catch { observer = await context.newCDPSession(source); send = (m, p) => observer.send(m, p); await send('DOM.enable'); }
    try {
      const { nodes } = await send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
      for (const node of nodes.filter(n => selector(attrs(n)))) {
        const { object } = await send('DOM.resolveNode', { nodeId: node.nodeId });
        const { result } = await send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: `function(){const r=this.getBoundingClientRect();return {dataset:{...this.dataset},borderWidth:getComputedStyle(this).borderWidth,outlineWidth:getComputedStyle(this).outlineWidth,outlineStyle:getComputedStyle(this).outlineStyle,after:getComputedStyle(this,'::after').content,before:getComputedStyle(this,'::before').content,productPaths:[...this.querySelectorAll('.product-icon svg path')].filter(p=>p.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(p=>p.getAttribute('d')),borderColor:getComputedStyle(this).borderColor,corners:["borderTopLeftRadius","borderTopRightRadius","borderBottomRightRadius","borderBottomLeftRadius"].map(k=>getComputedStyle(this)[k]),strokeWidths:[...this.querySelectorAll("svg path")].map(p=>getComputedStyle(p).strokeWidth),visible:this.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),inert:this.inert,x:r.x,y:r.y,width:r.width,height:r.height,visibleIconFills:[...this.querySelectorAll('.suite-icon svg path,.suite-icon svg rect,.product-icon svg path,.product-icon svg rect')].filter(p=>p.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(p=>getComputedStyle(p).fill),iconSizes:[...this.querySelectorAll('.suite-icon,.product-icon')].filter(p=>p.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(p=>({w:p.getBoundingClientRect().width,h:p.getBoundingClientRect().height})),iconGeometry:[...this.querySelectorAll('.suite-icon,.product-icon')].filter(n=>n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(n=>{const b=n.getBoundingClientRect(),radius=parseFloat(getComputedStyle(n).borderTopLeftRadius),rect=n.querySelector('svg>rect'),svg=n.querySelector('svg');return {x:b.x,y:b.y,w:b.width,h:b.height,radius,paintedRadius:rect?parseFloat(getComputedStyle(rect).rx)*b.width/svg.viewBox.baseVal.width:radius};}),background:getComputedStyle(this).backgroundColor,opacity:Number(getComputedStyle(this).opacity),radius:getComputedStyle(this).borderTopLeftRadius,hovered:this.matches(':hover'),focused:this.getRootNode().activeElement===this,viewBoxes:[...this.querySelectorAll("svg")].map(s=>s.getAttribute("viewBox")),transform:getComputedStyle(this).transform,strokes:[...this.querySelectorAll('svg path,svg rect')].map(p=>getComputedStyle(p).stroke),fills:[...this.querySelectorAll('svg path,svg rect')].map(p=>getComputedStyle(p).fill)}}`, returnByValue: true });
        await send('Runtime.releaseObject', { objectId: object.objectId });
        if (result.value?.visible) return result.value;
      }
      return null;
    } catch (error) {
      // Closing or reframing the canvas can invalidate the debugger or a DOM node between reads.
      if (!retried && /Debugger is not attached to the tab|No node with given id found/.test(String(error))) return await inspect(selector, true);
      throw error;
    } finally { await observer?.detach(); }
  }
  async function click(selector) {
    if (selector({class:'bar-save'})) await hoverAarre();
    let previous;
    const box = await until(async () => {
      const current = await inspect(selector);
      const stable = current && previous && ['x','y','width','height'].every(key => Math.abs(current[key] - previous[key]) < .5);
      previous = current; return stable ? current : false;
    }, '查找位置稳定的可操作入口');
    report.lastClick = {box, before: await state()};
    await source.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  const byClass = cls => attrs => (attrs.class || '').split(' ').includes(cls);
  async function hoverAarre() {
    const box=await until(()=>inspect(byClass('bar-toggle')),'Aarre 产品入口');
    await source.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await until(()=>inspect(byClass('bar-save')),'悬停展开收藏入口');
  }
  const frame = () => source.frames().find(f => f.url().startsWith(`chrome-extension://${aarreId}/floating.html`));


  async function sampleMotion(cls, key, duration, panelSelector = '.panel') {
    const observation = await context.newCDPSession(source);
    try {
      await observation.send('DOM.enable');
      const { nodes } = await observation.send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
      const surface = nodes.find(node => byClass(cls)(attrs(node)));
      const { object } = await observation.send('DOM.resolveNode', { nodeId: surface.nodeId });
      await observation.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: `function(key,duration,selector){
        const el=this,win=this.ownerDocument.defaultView,panel=el.getRootNode().querySelector(selector);win[key]=[];const start=performance.now();
        const animations=target=>target ? target.getAnimations().map(a=>{const t=a.effect.getTiming();return {duration:t.duration,delay:t.delay,easing:t.easing,frames:a.effect.getKeyframes().map(f=>({offset:f.offset,opacity:f.opacity,transform:f.transform}))}}) : [];
        function sample(){const r=el.getBoundingClientRect(),css=panel&&getComputedStyle(panel);win[key].push({t:performance.now()-start,width:r.width,height:r.height,surface:animations(el),content:animations(panel),opacity:css&&Number(css.opacity),transform:css&&css.transform});if(performance.now()-start<duration)requestAnimationFrame(sample)}sample()
      }`, arguments:[{value:key},{value:duration},{value:panelSelector}] });
    } finally { await observation.detach(); }
  }
  const near=(a,b)=>Math.abs(a-b)<.6;
  const surface=()=>inspect(byClass('dock-surface'));
  const nFrame=()=>source.frames().find(f=>f.url().startsWith(`chrome-extension://${nexId}/source-panel.html`));
  const closed=async()=>{await until(async()=>{const s=await state();return s.a?.open==='false'&&s.n?.menuOpen==='false'&&await surface();},'两个菜单收起');await pause(320);};
  const dragTo=async(y,dx=0,selector=byClass('bar-toggle'))=>{
    const b=await until(()=>inspect(selector),'拖动入口');
    await source.mouse.move(b.x+b.width/2,b.y+b.height/2);
    await source.mouse.down();await source.mouse.move(b.x+b.width/2+dx,y,{steps:18});await source.mouse.up();
    await pause(200);
  };
  const view=()=>source.evaluate(()=>({width:visualViewport?.width||innerWidth,height:visualViewport?.height||innerHeight}));
  const menuInside=async(cls,label)=>{
    const b=await until(()=>inspect(byClass(cls)),label),v=await view();
    check(near(b.x+b.width,v.width-8)&&near(b.y,12)&&near(b.height,v.height-24)&&b.corners.every(c=>c==='20px'),label,b);
    return b;
  };
  const closeA=async()=>{await frame().getByRole('button',{name:'收起菜单',exact:true}).click();await closed();};
  const closeN=async()=>{await click(a=>'data-floating-launcher' in a);await closed();};
  await source.mouse.move(400,300);await pause(350);
  let b=await surface(),v=await view();
  check(near(b.x+b.width,v.width-8)&&b.width===52&&b.height===96&&b.corners.every(c=>c==='16px'),'浮动把手距右侧 8px，四个角均为 R16',b);
  for(const cls of ['bar-toggle','bar-nexalign']) {
    const item=await inspect(byClass(cls)),i=item.iconGeometry[0];
    check(item.width===44&&item.height===44&&i.w===36&&i.h===36&&near(i.x+i.w/2,item.x+22)&&near(i.y+i.h/2,item.y+22)&&JSON.stringify(item.productPaths)===JSON.stringify(productPaths[cls==='bar-toggle'?'aarre':'nexalign']),'36px 正式应用图标在 44px 入口内居中：'+cls,item);
  }
  const upper=await inspect(byClass('bar-toggle')),lower=await inspect(byClass('bar-nexalign'));
  const aIcon=upper.iconGeometry[0],nIcon=lower.iconGeometry[0];
  check(near(nIcon.y-aIcon.y-aIcon.h,8)&&near(aIcon.y-b.y,8)&&near(b.y+b.height-nIcon.y-nIcon.h,8)&&near(aIcon.x-b.x,8)&&near(b.x+b.width-aIcon.x-aIcon.w,8)&&lower.before==='none','可见图标之间及与外框的间距均为 8px，无分隔线',{bar:b,upper,lower});
  const manager=await context.newPage();await manager.goto(`chrome-extension://${aarreId}/manager.html`);await manager.locator('.manager-brand').waitFor();
  for(const theme of ['light','dark']) {
    await manager.bringToFront();
    if(await manager.evaluate(()=>document.documentElement.dataset.theme)!==theme) await manager.getByRole('button',{name:theme==='dark'?'切换到夜间模式':'切换到日间模式',exact:true}).click();
    await until(async()=>(await state()).a.suiteTheme===theme,'主题同步');
    await source.bringToFront();await until(()=>source.evaluate(()=>document.hasFocus()),'网页窗口获得焦点');await source.mouse.move(500,250);await pause(300);
    const normal=await inspect(byClass('bar-toggle'));
    await source.screenshot({path:path.join(artifact,`handle-${theme}.png`),clip:{x:1050,y:340,width:230,height:220}});
    await hoverAarre();await pause(180);
    if (!await inspect(byClass('bar-save'))) {
      // A native tab activation may finish after the first pointer move. Re-enter once.
      await source.bringToFront();await source.mouse.move(500,250);await pause(180);await hoverAarre();await pause(180);
    }
    const hover=await inspect(byClass('bar-toggle')),quick=await inspect(byClass('bar-save'));
    const quickShell=await inspect(byClass('quick-actions'));
    check(hover.background!==normal.background&&hover.borderWidth==='0px'&&quick.iconSizes[0].w===22&&quick.borderWidth==='0px'&&quickShell.borderWidth==='0px',`${theme}：轻量 hover，收藏入口没有嵌套描边`,{normal,hover,quick,quickShell});
    await source.screenshot({path:path.join(artifact,`hover-${theme}.png`),clip:{x:1050,y:340,width:230,height:220}});
    await until(async()=>{
      await source.mouse.move(quick.x+22,quick.y+22);await pause(180);
      const button=await inspect(byClass('bar-save')),shell=await inspect(byClass('quick-actions'));
      return button?.hovered&&shell?.background!==quickShell.background;
    },'实际指针进入收藏入口并完成悬停反馈',5000);
    const quickHovered=await inspect(byClass('bar-save')),shellHovered=await inspect(byClass('quick-actions'));
    check(quickHovered.background==='rgba(0, 0, 0, 0)'&&quickHovered.borderWidth==='0px'&&quickHovered.outlineStyle==='none'&&shellHovered.borderWidth==='0px'&&shellHovered.background!==quickShell.background,`${theme}：收藏悬停只改变单层浮动底色`,{quickHovered,shellHovered});
    await source.screenshot({path:path.join(artifact,`save-hover-${theme}.png`),clip:{x:1050,y:340,width:230,height:220}});
  }
  await manager.close();
  // Horizontal pointer movement is ignored by placement, but still suppresses a drag's click.
  const beforeHorizontal=await surface();await dragTo(beforeHorizontal.y+26,-220);
  b=await surface();check(near(b.x,beforeHorizontal.x)&&near(b.y,beforeHorizontal.y)&&(await state()).a.open==='false','横向拖动不改变位置、不误开菜单',b);
  for(const [label,y] of [['top',5],['middle',390],['bottom',895]]) {
    await dragTo(y,-160);await closed();b=await surface();v=await view();
    check(near(b.x+b.width,v.width-8)&&b.y>=7.5&&b.y+b.height<=v.height-7.5,`${label}：仅上下移动且不超出视口`,b);
    const parked=b;
    if(label==='bottom') await sampleMotion('dock-surface','__dockAOpen',650);
    await click(byClass('bar-toggle'));await until(async()=>frame()&&await frame().getByRole('button',{name:'收起菜单',exact:true}).isVisible(),'Aarre 真正就绪');await pause(320);
    const am=await menuInside('panel',`${label}：Aarre 从当前位置正常展开`);
    if(label==='top') await source.screenshot({path:path.join(artifact,'aarre-open.png')});
    await closeA();b=await surface();check(near(b.y,parked.y),'Aarre 收起回到拖动位置：'+label,{before:parked,after:b});
    if(label==='bottom') await sampleMotion('dock-surface-nex','__dockNOpen',650,'.menu');
    await click(byClass('bar-nexalign'));await until(async()=>nFrame()&&await nFrame().locator('.floating-source-panel').isVisible(),'NexAlign 真正就绪');await pause(320);
    const nm=await menuInside('menu',`${label}：NexAlign 从同一位置正常展开`);
    check(near(am.width,nm.width)&&near(am.height,nm.height),'两主程序展开尺寸一致：'+label,{am,nm});
    if(label==='top') await source.screenshot({path:path.join(artifact,'nexalign-open.png')});
    if(label==='bottom') {
      report.motion=await source.evaluate(()=>({a:window.__dockAOpen,n:window.__dockNOpen}));
      const motionFor=samples=>({surface:samples.flatMap(s=>s.surface)[0],content:samples.flatMap(s=>s.content)[0]});
      const a=motionFor(report.motion.a),n=motionFor(report.motion.n);
      check(JSON.stringify(a)===JSON.stringify(n)&&a.surface.duration===280&&a.content.duration===140,'拖动后两程序实际展开关键帧、时长与缓动完全相同',{a,n});
      check(Object.values(report.motion).every(samples=>samples.some(s=>s.width>55&&s.width<399)&&samples.some(s=>s.opacity>0&&s.opacity<1)),'两程序均有连续展开与淡入中间帧');
    }

    await closeN();b=await surface();check(near(b.y,parked.y),'NexAlign 收起回到共享拖动位置：'+label,{before:parked,after:b});
    if(label!=='middle') {
      await click(byClass('bar-save'));await until(async()=>frame()&&await frame().getByRole('textbox',{name:'名称',exact:true}).isVisible(),'收藏表单就绪');await pause(320);
      const task=await inspect(byClass('panel'));v=await view();
      check(task.y>=11.5&&task.y+task.height<=v.height-11.5&&task.height<am.height,'收藏表单在边缘自动避让：'+label,task);
      await source.screenshot({path:path.join(artifact,`save-${label}.png`)});
      await frame().locator('.native-dialog-actions').getByRole('button',{name:'取消',exact:true}).click();await closed();
    }
  }
  const old=await surface();await source.reload();await until(async()=>{const s=await state();return s.a?.suitePaired==='true'&&s.n?.suitePaired==='true';},'刷新恢复共享把手');await closed();
  b=await surface();check(near(old.y,b.y),'刷新网页保留拖动位置',{old,b});
  await source.setViewportSize({width:420,height:480});await pause(350);b=await surface();v=await view();
  check(b.y>=8&&near(b.y+b.height,v.height-8)&&near(b.x+b.width,v.width-8),'缩小窗口保持下端位置和 8px 间距',{bar:b,viewport:v});
  await click(byClass('bar-toggle'));await until(async()=>frame()&&await frame().getByRole('button',{name:'收起菜单',exact:true}).isVisible(),'窄窗 Aarre');await pause(320);
  await menuInside('panel','窄窗口 Aarre 可完整展开');await closeA();
  await click(byClass('bar-nexalign'));await until(async()=>nFrame()&&await nFrame().locator('.floating-source-panel').isVisible(),'窄窗 NexAlign');await pause(320);
  await menuInside('menu','窄窗口 NexAlign 可完整展开');await closeN();
  await source.setViewportSize({width:1280,height:900});await pause(250);
  await dragTo(300);b=await surface();
  await source.keyboard.press('Home');await pause(120);check(near((await surface()).y,8),'Home 将把手移到顶部');
  await source.keyboard.press('End');await pause(120);b=await surface();v=await view();check(near(b.y,v.height-b.height-8),'End 将把手移到底部');
  await source.keyboard.press('ArrowUp');await pause(120);check(near((await surface()).y,b.y-12),'方向键可上下微调');
  await source.emulateMedia({reducedMotion:'reduce'});
  await click(byClass('bar-toggle'));await until(async()=>frame()&&await frame().getByRole('button',{name:'收起菜单',exact:true}).isVisible(),'减少动态效果');
  await menuInside('panel','减少动态效果仍正常展开');await closeA();await source.emulateMedia({reducedMotion:'no-preference'});
  await click(byClass('bar-save'));await until(async()=>frame()&&await frame().getByRole('textbox',{name:'名称',exact:true}).isVisible(),'添加收藏');
  await frame().getByRole('textbox',{name:'名称',exact:true}).fill('浮动把手真实收藏验收');await frame().getByRole('button',{name:'添加到 Chrome',exact:true}).click();
  await until(async()=>(await aarre.evaluate(url=>chrome.bookmarks.search({url}),url)).length===1,'Chrome 真实收藏写入');
  if((await state()).a.open==='true') await closeA();else await closed();
  await hoverAarre();await pause(160);const selected=await inspect(byClass('bar-save'));
  check(selected.dataset.saved==='true'&&selected.fills.every(f=>f!=='none')&&selected.borderWidth==='0px'&&selected.background==='rgba(0, 0, 0, 0)'&&selected.after==='none','已收藏仅由实心星标表达，无常驻内框或额外标记',selected);
  await source.screenshot({path:path.join(artifact,'saved-state.png'),clip:{x:1050,y:680,width:230,height:220}});
  await source.mouse.move(selected.x+22,selected.y+22);await pause(180);
  await source.screenshot({path:path.join(artifact,'saved-hover.png'),clip:{x:1050,y:680,width:230,height:220}});
  await source.mouse.move(500,300);await browser.send('Extensions.uninstall',{id:aarreId});
  await until(async()=>{const s=await state();return !s.a&&s.n?.suitePaired==='false';},'独立 NexAlign',25000);await pause(320);
  await dragTo(140,-200,a=>'data-floating-launcher' in a);const single=await inspect(byClass('dock-surface-nex'));
  const singleN=await inspect(a=>'data-floating-launcher' in a);
  check(singleN.iconSizes[0].w===36&&JSON.stringify(singleN.productPaths)===JSON.stringify(productPaths.nexalign),'独立 NexAlign 仍使用正式应用图标',singleN);
  await source.screenshot({path:path.join(artifact,'standalone-nexalign.png'),clip:{x:1150,y:40,width:130,height:220}});
  check(single.width===52&&single.height===52&&near(single.x+single.width,1272)&&single.y<200&&(await state()).n.menuOpen==='false','NexAlign 单独安装可上下拖动、松手不误开',single);
  await click(a=>'data-floating-launcher' in a);await until(async()=>nFrame()&&await nFrame().locator('.floating-source-panel').isVisible(),'独立 NexAlign 展开');await pause(320);
  await menuInside('menu','独立 NexAlign 拖动后正常展开');await click(a=>'data-floating-launcher' in a);await pause(350);
  check(near((await inspect(byClass('dock-surface-nex'))).y,single.y),'独立 NexAlign 收起返回拖动位置');
  await browser.send('Extensions.uninstall',{id:nexId});
  await browser.send('Extensions.loadUnpacked',{path:aarrePath});await source.reload();
  await until(()=>inspect(byClass('bar-toggle')),'独立 Aarre');await pause(350);
  await dragTo(200,100);b=await surface();check(b.height===52&&near(b.x+b.width,1272)&&b.y<240&&(await state()).a.open==='false','Aarre 单独安装可上下拖动、松手不误开',b);
  const singleA=await inspect(byClass('bar-toggle'));
  check(singleA.iconSizes[0].w===36&&JSON.stringify(singleA.productPaths)===JSON.stringify(productPaths.aarre),'独立 Aarre 仍使用正式应用图标',singleA);
  await source.screenshot({path:path.join(artifact,'standalone-aarre.png'),clip:{x:1150,y:100,width:130,height:220}});
  await click(byClass('bar-toggle'));await until(async()=>frame()&&await frame().getByRole('button',{name:'收起菜单',exact:true}).isVisible(),'独立 Aarre 展开');await pause(320);
  await menuInside('panel','独立 Aarre 拖动后正常展开');await frame().getByRole('button',{name:'收起菜单',exact:true}).click();await pause(350);
  check(near((await surface()).y,b.y),'独立 Aarre 收起返回拖动位置');
  check(report.errors.length===0,'没有记录到页面运行异常');
} catch(error) {report.error=error.stack;console.error(error);process.exitCode=1;await context?.pages()[0]?.screenshot({path:path.join(artifact,'error.png')}).catch(()=>{});}
finally {
  clearTimeout(deadline);
  await writeFile(path.join(artifact,'report.json'),JSON.stringify(report,null,2));
  await context?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await rm(profile,{recursive:true,force:true});
}

// Focused real-extension reproduction, adapted from LayerScope verify-shared-dock.mjs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const artifact = path.resolve(process.env.SUITE_ARTIFACT_DIR || 'work/verification-save-transition');
await mkdir(artifact, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), 'nex-suite-'));
const nexPath = path.resolve('../LayerScope/dist'), aarrePath = path.resolve('dist');
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
const deadline = setTimeout(() => { report.timeout = true; void context?.close(); }, 240_000);
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: process.env.SUITE_VERIFY_PRODUCT_HANDLE === '1' ? 2 : 1, recordVideo: { dir: artifact, size: { width: 1280, height: 900 } }, ignoreDefaultArgs: ['--disable-extensions'],
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
  await nex.evaluate(() => {
    globalThis.__suiteTrace=[];
    chrome.runtime.onMessage.addListener((m) => { if(m?.type==='FLOATING_CANVAS_SET_ACTIVE') globalThis.__suiteTrace.push({at:Date.now(),type:m.type,active:m.active,id:m.requestId}); return false; });
    for (const method of ['attach','detach']) {
      const original=chrome.debugger[method].bind(chrome.debugger);
      chrome.debugger[method]=async(...args)=>{
        globalThis.__suiteTrace.push({at:Date.now(),type:method+'-start'});
        const result=await original(...args);
        globalThis.__suiteTrace.push({at:Date.now(),type:method+'-done'}); return result;
      };
    }
  });
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
  async function inspect(selector) {
    // Use the extension's debugger while it owns the source, otherwise a short read-only observation session.
    let observer;
    const sendOwned = (method, params = {}) => nex.evaluate(async ({ tabId, method, params }) => chrome.debugger.sendCommand({ tabId }, method, params), { tabId, method, params });
    let send = sendOwned;
    try { if (!nexAvailable) throw new Error('Extension was unloaded'); await send('DOM.enable'); } catch { observer = await context.newCDPSession(source); send = (m, p) => observer.send(m, p); await send('DOM.enable'); }
    try {
      const { nodes } = await send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
      for (const node of nodes.filter(n => selector(attrs(n)))) {
        const { object } = await send('DOM.resolveNode', { nodeId: node.nodeId });
        const { result } = await send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: `function(){const r=this.getBoundingClientRect();return {visible:this.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),inert:this.inert,x:r.x,y:r.y,width:r.width,height:r.height,background:getComputedStyle(this).backgroundColor,opacity:Number(getComputedStyle(this).opacity),radius:getComputedStyle(this).borderTopLeftRadius,focused:this.getRootNode().activeElement===this,viewBoxes:[...this.querySelectorAll("svg")].map(s=>s.getAttribute("viewBox")),transform:getComputedStyle(this).transform,strokes:[...this.querySelectorAll('svg path,svg rect')].map(p=>getComputedStyle(p).stroke),fills:[...this.querySelectorAll('svg path,svg rect')].map(p=>getComputedStyle(p).fill)}}`, returnByValue: true });
        await send('Runtime.releaseObject', { objectId: object.objectId });
        if (result.value?.visible) return result.value;
      }
      return null;
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
  async function trace(name, action) {
    const obs = await context.newCDPSession(source);
    await obs.send('DOM.enable');
    const {nodes} = await obs.send('DOM.getFlattenedDocument',{depth:-1,pierce:true});
    const surface = nodes.find(n => byClass('dock-surface')(attrs(n)));
    const {object} = await obs.send('DOM.resolveNode',{nodeId:surface.nodeId});
    await obs.send('Runtime.callFunctionOn', {objectId:object.objectId, functionDeclaration:`function(){
      const root=this.getRootNode(), surface=this, panel=root.querySelector('.panel');
      window.__saveTrace=[]; window.__saveEvents=[]; window.__stopSaveTrace=false; const start=performance.now(); window.__saveStart=performance.timeOrigin+start;
      const listener=e=>{if(e.data?.type?.startsWith('FLOAT_'))window.__saveEvents.push({t:performance.now()-start,type:e.data.type,height:e.data.height});};
      window.addEventListener('message',listener);
      const clicked=()=>window.__saveEvents.push({t:performance.now()-start,type:'LAUNCHER_POINTER_DOWN'});
      document.addEventListener('pointerdown',clicked,{capture:true,once:true});
      const animations=el=>el.getAnimations().map(a=>{const t=a.effect.getTiming();return {duration:t.duration,delay:t.delay,easing:t.easing};});
      function tick(){const r=surface.getBoundingClientRect();const p=panel.getBoundingClientRect();
        window.__saveTrace.push({t:performance.now()-start,w:r.width,h:r.height,ph:p.height,opacity:Number(getComputedStyle(panel).opacity),visible:panel.checkVisibility({checkOpacity:true}),loading:!root.querySelector('.loading').hidden,open:root.host.dataset.open,surface:animations(surface),content:animations(panel)});
        if(!window.__stopSaveTrace&&performance.now()-start<20000)requestAnimationFrame(tick);else {window.removeEventListener('message',listener);document.removeEventListener('pointerdown',clicked,true);}
      }tick();
    }`});
    await obs.detach();
    const closingSave = !name.includes('save') && !name.includes('main');
    if (closingSave) await frame().evaluate(() => {
      window.__closedAt = null;
      const listener = event => {
        if (event.data?.type !== 'FLOAT_CLOSED') return;
        window.__closedAt = performance.timeOrigin + performance.now();
        window.removeEventListener('message', listener);
      };
      window.addEventListener('message', listener);
    });
    await action();
    let layers, retainedDuringClose;
    if (name.includes('save')) {
      await until(async () => (await state()).a.open === 'true', '立即展开收藏加载面板');
      await source.screenshot({ path: path.join(artifact, name+'-opening.png') });
      if(name==='cold-save') {await pause(350);await source.screenshot({path:path.join(artifact,'loading.png')});}
      await until(async () => (await state()).a.savePreparing === 'false' && frame() && await frame().locator('.save-source').isVisible(), '在稳定外框内完成收藏内容加载');
      layers=await frame().locator('.floating-save-page').evaluate(dialog=>{
        const result=[];
        for(let el=dialog;el;el=el.parentElement){const css=getComputedStyle(el);result.push({className:el.className,opacity:Number(css.opacity),animation:css.animationName,transform:css.transform});}
        return result;
      });
    } else if (closingSave) {
      retainedDuringClose = await frame().locator('.floating-save-page').count() === 1;
      await source.screenshot({ path: path.join(artifact, name+'-closing.png') });
    }
    await pause(400);
    await source.evaluate(()=>window.__stopSaveTrace=true);
    await pause(30);
    report[name]={frames:await source.evaluate(()=>window.__saveTrace),events:await source.evaluate(()=>window.__saveEvents),layers,retainedDuringClose};
    if (closingSave) {
      const closedAt = await frame().evaluate(() => window.__closedAt);
      if (closedAt) report[name].events.push({type:'FLOAT_CLOSED',t:closedAt-await source.evaluate(()=>window.__saveStart)});
    }
    const sizes=[...new Set(report[name].frames.filter(f=>f.visible&&f.opacity>.95).map(f=>Math.round(f.ph)))];
    console.log(name, {visiblePanelHeights:sizes,events:report[name].events});
    await source.screenshot({path:path.join(artifact,name+'.png')});
  }
  // Delay a real Chrome read, never fabricate the returned data. This proves
  // that slow preparation cannot delay the first animation frame.
  await aarre.evaluate(() => {
    const getTree=chrome.bookmarks.getTree.bind(chrome.bookmarks);
    globalThis.__slowReadMs=2300;globalThis.__slowReads=0;
    chrome.bookmarks.getTree=async (...args)=>{
      const delay=globalThis.__skipReads>0?(globalThis.__skipReads--,0):globalThis.__slowReadMs;
      if(delay){globalThis.__slowReads++;await new Promise(resolve=>setTimeout(resolve,delay));}
      return getTree(...args);
    };
  });
  if (process.env.SUITE_VERIFY_PRODUCT_HANDLE === '1') {
    await aarre.evaluate(()=>{globalThis.__slowReadMs=0;});
    const waitForForm = async () => {
      await until(async()=>{
        const panel=await inspect(byClass('panel')), owned=await inspect(attrs=>attrs.title==='Aarre 收藏菜单');
        return (await state()).a.savePreparing==='false'&&panel?.opacity===1&&panel.transform==='none'&&owned&&!owned.inert;
      },'父面板和 iframe 完成显示与交互交接');
      await frame().evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    };
    const detailShot = name => source.screenshot({path:path.join(artifact,name+'.png'),clip:{x:1100,y:340,width:180,height:220}});
    await source.mouse.move(400,300); await pause(300);
    report.handleLight={a:await inspect(byClass('bar-toggle')),n:await inspect(byClass('bar-nexalign')),surface:await inspect(byClass('dock-surface'))};
    const {a,n,surface}=report.handleLight;
    check(a&&n&&!await inspect(byClass('bar-save'))&&!await inspect(attrs=>'data-floating-launcher' in attrs),'静止时只有两个产品入口，没有常驻星标或重复把手');
    check(a.viewBoxes.includes('0 0 128 128')&&a.fills.includes('rgb(242, 99, 61)')&&a.fills.includes('rgb(249, 240, 213)')&&n.viewBoxes.includes('0 0 218 218'),'使用真实 Aarre A1 与 NexAlign 图形及原品牌填色');
    check(surface.width===52&&surface.height===100&&surface.radius==='16px'&&[a,n].every(b=>b.width===44&&b.height===44&&b.radius==='12px'),'把手 52×100、按钮 44×44，16px 外框 / 12px 按钮 / 8px 图标同心圆角');
    await detailShot('handle-light');
    await hoverAarre(); await pause(200);
    report.hoverLight=await inspect(byClass('bar-save'));
    check(report.hoverLight.width===44&&report.hoverLight.height===44&&report.hoverLight.x+44<a.x,'悬停 Aarre 时只向左展开正方形收藏按钮');
    await detailShot('hover-light');
    await source.mouse.move(report.hoverLight.x+22,report.hoverLight.y+22,{steps:8}); await pause(200);
    check(await inspect(byClass('bar-save')),'鼠标跨过间隙后仍能操作收藏按钮');
    await source.mouse.move(400,300); await pause(300);
    check(!await inspect(byClass('bar-save')),'移出操作区后恢复两个产品入口');
    await source.getByRole('button',{name:'网页按钮',exact:true}).click();
    for(let i=0;i<6&&!((await inspect(byClass('bar-toggle')))?.focused);i++) await source.keyboard.press('Tab');
    await source.keyboard.press('ArrowLeft');
    await until(async()=>(await inspect(byClass('bar-save')))?.focused,'等待键盘操作的可见帧');
    check(true,'键盘聚焦产品后，左方向键可进入收藏操作');
    await source.keyboard.press('Escape'); await pause(200);
    check(!await inspect(byClass('bar-save'))&&(await inspect(byClass('bar-toggle')))?.focused&&(await state()).a.open==='false','Esc 只收起快捷操作并保留产品焦点');
    await trace('save-handle',()=>click(byClass('bar-save')));
    check(await frame().locator('#native-dialog-title').innerText()==='添加到收藏','悬停收藏按钮进入真实添加表单');
    await trace('cancel',()=>frame().locator('.native-dialog-actions').getByRole('button',{name:'取消',exact:true}).click());
    check((await aarre.evaluate(url=>chrome.bookmarks.search({url}),url)).length===0,'取消没有新增书签');
    await click(byClass('bar-save'));
    await until(async()=>{
      const panel=await inspect(byClass('panel'));
      return (await state()).a.savePreparing==='false'&&panel?.opacity===1&&panel.transform==='none'&&frame()&&await frame().locator('.save-source').isVisible();
    },'真实表单已显示且可交互');
    await frame().getByRole('textbox',{name:'名称',exact:true}).fill('产品把手收藏验证');
    await frame().getByRole('button',{name:'添加到 Chrome',exact:true}).click();
    await until(async()=>(await aarre.evaluate(url=>chrome.bookmarks.search({url}),url)).length===1,'临时 Chrome 内实际写入一条收藏');
    if ((await state()).a.open==='true') await frame().getByRole('button',{name:'收起菜单',exact:true}).click();
    await until(async()=>(await state()).a.open==='false','保存后收起');
    await hoverAarre(); await pause(200);
    const savedStar=await until(()=>inspect(attrs=>byClass('bar-save')(attrs)&&attrs['data-saved']==='true'),'已收藏状态同步至星标');
    check(savedStar?.fills.some(fill=>fill!=='none'),'已收藏网页仍以实心星标反馈');
    await detailShot('hover-saved');
    await click(byClass('bar-save'));
    await until(async()=>await frame().locator('#native-dialog-title').innerText().catch(()=>'')==='管理此收藏','再次进入管理已有收藏');
    await waitForForm();
    await frame().locator('.native-dialog-actions').getByRole('button',{name:'取消',exact:true}).click();
    await until(async()=>(await state()).a.open==='false','管理已有收藏取消后收起');await pause(350);
    check((await aarre.evaluate(url=>chrome.bookmarks.search({url}),url)).length===1,'再次进入不会重复添加');
    await trace('main-open',()=>click(byClass('bar-toggle')));
    if(await frame().getByRole('button',{name:'跳过引导',exact:true}).isVisible()) await frame().getByRole('button',{name:'跳过引导',exact:true}).click();
    await until(async()=>await frame().locator('#bookmark-agent-prompt').isVisible(),'产品图标直接打开收藏菜单');
    check(report['main-open'].frames.some(f=>f.surface.some(a=>a.duration===280)),'点击产品图标保持原有菜单展开动画');
    await trace('main-close',()=>frame().getByRole('button',{name:'收起菜单',exact:true}).click());
    await source.mouse.move(400,300); await pause(300);
    check(!await inspect(byClass('bar-save')),'鼠标关闭主菜单后不意外展开快捷操作');
    await click(byClass('bar-nexalign'));
    const peerFrame=()=>source.frames().find(f=>f.url().startsWith(`chrome-extension://${nexId}/source-panel.html`));
    await until(async()=>peerFrame()&&await peerFrame().getByRole('button',{name:'检查元素，快捷键 V',exact:true}).isVisible(),'真实 NexAlign 检查菜单');
    check((await state()).n.menuOpen==='true'&&(await state()).a.open==='false'&&!await inspect(byClass('bar-save')),'NexAlign 产品图标打开对应菜单，快捷操作不残留');
    await peerFrame().getByRole('tab',{name:'设置',exact:true}).click();
    const {chooseFloatingTheme}=await import('../../LayerScope/scripts/floating-theme-contracts.mjs');
    await chooseFloatingTheme(peerFrame(),'深色');
    await until(async()=>(await state()).a.suiteTheme==='dark','真实主题设置同步至把手');
    await click(attrs=>'data-floating-launcher' in attrs);
    await until(async()=>(await state()).a.suiteAway==='false','返回共享把手');await pause(350);
    await source.mouse.move(400,300); await detailShot('handle-dark');
    await hoverAarre();await pause(200);await detailShot('hover-dark');
    check((await inspect(byClass('bar-save')))?.width===44,'深色主题下悬停收藏入口仍正常');
    await source.mouse.move(400,300);await pause(300);
    await source.setViewportSize({width:360,height:480}); await hoverAarre();await pause(200);
    const narrow=await inspect(byClass('bar-save'));
    check(narrow.x>=0&&narrow.y>=0&&narrow.x+narrow.width<=360,'窄窗口下二级操作仍在视口内');
    await source.screenshot({path:path.join(artifact,'narrow.png')});
    await source.setViewportSize({width:1280,height:900}); await source.mouse.move(400,300);
    await browser.send('Extensions.uninstall',{id:aarreId});
    await until(async()=>{const s=await state();return !s.a&&s.n?.suitePaired==='false';},'卸载后的 Aarre 宿主清理完成，独立 NexAlign 可见',25_000);await pause(350);
    const standalone=await inspect(attrs=>'data-floating-launcher' in attrs);
    report.standaloneNexalign=standalone;
    check(standalone?.viewBoxes.includes('0 0 218 218')&&!await inspect(byClass('bar-toggle')),'独立 NexAlign 同样使用正式产品图标');
    await detailShot('standalone-nexalign');
    await browser.send('Extensions.loadUnpacked',{path:aarrePath});
    await until(async()=>(await state()).a?.suitePaired==='true','重新配对');
    await browser.send('Extensions.uninstall',{id:nexId});
    await until(async()=>{const s=await state();return !s.n&&s.a?.suitePaired==='false';},'卸载后的 NexAlign 宿主清理完成，独立 Aarre 可见',25_000); await pause(350);
    check(!await inspect(byClass('bar-nexalign'))&&(await inspect(byClass('dock-surface'))).height===52,'仅安装 Aarre 时只显示一个真实产品入口');
    await hoverAarre();await pause(200);await detailShot('standalone-aarre');
    check(await inspect(byClass('bar-save')),'独立 Aarre 仍可悬停使用收藏');
  } else if (process.env.SUITE_VERIFY_MAIN_FIRST === '1') {
    // A bounded delay in delivery of the real coordination message reproduces
    // a cold/slow peer. Identity, message contents and bookmark data stay real.
    await aarre.evaluate(() => {
      globalThis.__suiteOpenDelay = 1000;
      chrome.runtime.onConnect.addListener(port => {
        if (port.name !== 'nex-suite-dock-v1') return;
        const post = port.postMessage.bind(port);
        port.postMessage = message => {
          if (message.type === 'OPEN' && globalThis.__suiteOpenDelay) {
            setTimeout(() => { try { post(message); } catch {} }, globalThis.__suiteOpenDelay);
          } else post(message);
        };
      });
    });
    await source.reload();
    await until(async () => (await state()).a?.suitePaired === 'true', '重新连接真实双插件');
    const openMain = async (name, captureLoading = false) => {
      await trace(name, async () => {
        await click(byClass('bar-toggle'));
        await until(async () => (await state()).a.open === 'true', '主菜单立即展开');
        if (captureLoading) {
          await pause(350);
          await source.screenshot({path:path.join(artifact,'main-loading.png')});
        }
        await until(async () => frame() && (
          await frame().getByRole('button',{name:'跳过引导',exact:true}).isVisible() ||
          await frame().locator('#bookmark-agent-prompt').isVisible()
        ), '主菜单内容完成加载');
        if (await frame().getByRole('button',{name:'跳过引导',exact:true}).isVisible()) {
          await frame().getByRole('button',{name:'跳过引导',exact:true}).click();
        }
        await until(async () => await frame().locator('#bookmark-agent-prompt').isVisible(), '收藏与对话入口可用');
      });
    };
    await openMain('cold-main-open', true);
    report.slowReads = await aarre.evaluate(() => { globalThis.__slowReadMs=0; return globalThis.__slowReads; });
    await trace('main-close', () => frame().getByRole('button',{name:'收起菜单',exact:true}).click());
    await openMain('warm-main-open');
    await trace('warm-main-close', () => frame().getByRole('button',{name:'收起菜单',exact:true}).click());
    // Cancel before the delayed OPEN arrives. It must not resurrect the panel.
    await aarre.evaluate(() => { globalThis.__slowReadMs=2300; });
    await source.reload();
    await until(async () => (await state()).a?.suitePaired === 'true', '取消场景的首次连接');
    await click(byClass('bar-toggle'));
    await until(async () => (await state()).a.open === 'true', '加载外框出现');
    await click(byClass('loading-close'));
    await pause(1300);
    check((await state()).a.open === 'false', '加载中关闭后，迟到的协调回复不会重新展开');
    await aarre.evaluate(() => { globalThis.__suiteOpenDelay=0; globalThis.__slowReadMs=0; });
    await openMain('reopened-main-open');
    await trace('reopened-main-close', () => frame().getByRole('button',{name:'收起菜单',exact:true}).click());
    await trace('save-after-main', () => click(byClass('bar-save')));
    await trace('cancel', () => frame().locator('.native-dialog-actions').getByRole('button',{name:'取消',exact:true}).click());
    check(report['save-after-main'].frames.some(f=>f.surface.some(a=>a.duration===280))&&report.cancel.frames.some(f=>f.surface.some(a=>a.duration===210))&&report['save-after-main'].layers.every(layer=>layer.opacity===1&&layer.animation==='none'&&layer.transform==='none'),'收藏入口仍保持统一开合动画和直接显示表单');
    check((await aarre.evaluate(url=>chrome.bookmarks.search({url}),url)).length===0,'打开及取消没有写入收藏');
    for (const name of ['cold-main-open','warm-main-open','reopened-main-open']) {
      const entry=report[name], clicked=entry.events.find(e=>e.type==='LAUNCHER_POINTER_DOWN');
      const started=entry.frames.find(f=>f.t>=clicked.t&&f.surface.length>0);
      const first=entry.frames.find(f=>f.t>=clicked.t&&f.w>53);
      entry.animationStartMs=started.t-clicked.t; entry.firstMotionMs=first.t-clicked.t;
      check(entry.animationStartMs<100&&entry.firstMotionMs<150,name+'：点击后动画立即开始',{start:entry.animationStartMs,firstPaint:entry.firstMotionMs});
      const reference=report['cold-main-open'];
      const signature=e=>[...new Set(e.frames.flatMap(f=>[...f.surface,...f.content]).map(a=>JSON.stringify(a)))].sort();
      check(JSON.stringify(signature(entry))===JSON.stringify(signature(reference)),name+'：沿用一致的展开动画');
    }
    const cold=report['cold-main-open'];
    const clicked=cold.events.find(e=>e.type==='LAUNCHER_POINTER_DOWN');
    const ready=cold.events.find(e=>e.type==='FLOAT_READY');
    check(report.slowReads>0&&ready.t-clicked.t>2200&&cold.frames.some(f=>f.t<clicked.t+1000&&f.visible&&f.opacity===1&&f.loading),'内容慢读和协调等待期间，外框已展开且显示内部加载');
    for (const name of ['main-close','warm-main-close','reopened-main-close']) {
      const entry=report[name], last=entry.frames.at(-1);
      check(last.w===52&&!last.visible&&entry.frames.some(f=>f.surface.some(a=>a.duration===210)),name+'：直接运行共享收起动画，结束后只留手柄');
    }
  } else {
  await trace('cold-save',()=>click(byClass('bar-save')));
  report.slowReads=await aarre.evaluate(()=>{globalThis.__slowReadMs=0;return globalThis.__slowReads;});
  check(report.slowReads>0,'首次打开实际经历了人为延长的 Chrome 读取');
  await until(async()=>frame() && await frame().locator('.save-source').isVisible(),'收藏页面');
  await trace('cancel',()=>frame().locator('.native-dialog-actions').getByRole('button',{name:'取消',exact:true}).click());
  await until(async()=>(await state()).a.open==='false','已关闭');
  await trace('warm-save',()=>click(byClass('bar-save')));
  await until(async()=>frame() && await frame().locator('.save-source').isVisible(),'重开收藏');
  await trace('close',()=>frame().locator('.dialog-close').click());
  await aarre.evaluate(()=>{globalThis.__slowReadMs=2300;globalThis.__skipReads=1;});
  await click(byClass('bar-save'));
  await until(async()=>{const box=await inspect(byClass('panel'));return box?.opacity===1&&(await state()).a.savePreparing==='true';},'加载中面板已展开');
  await click(byClass('loading-cancel'));
  await until(async()=>(await state()).a.open==='false','加载中取消立即开始收起');
  await pause(2600);
  check((await state()).a.open==='false'&&!frame(),'加载中取消后，迟到的数据不会重开面板');
  await aarre.evaluate(()=>{globalThis.__slowReadMs=0;});
  await trace('main-open',()=>click(byClass('bar-toggle')));
  // A fresh disposable profile has not completed onboarding yet.
  if(await frame().getByRole('button',{name:'跳过引导',exact:true}).isVisible()) await frame().getByRole('button',{name:'跳过引导',exact:true}).click();
  await until(async()=>frame() && await frame().locator('#bookmark-agent-prompt').isVisible(),'Aarre 主菜单');
  check(await frame().locator('.floating-save-page').count()===0,'加载中取消后重开主菜单不会恢复已取消的表单');
  await until(async()=>{const box=await inspect(byClass('panel'));return box?.opacity===1&&!box.inert;},'主菜单可操作');
  await trace('main-close',()=>frame().getByRole('button',{name:'收起菜单',exact:true}).click());
  await until(async()=>(await state()).a.open==='false','主菜单已关闭');
  await pause(230);
  await click(byClass('bar-nexalign'));
  await until(()=>nex.evaluate(async tabId=>{try{await chrome.debugger.sendCommand({tabId},'Runtime.evaluate',{expression:'0'});return true;}catch{return false;}},tabId),'NexAlign 接入');
  await until(async()=>{
    const f=source.frames().find(f=>f.url().startsWith(`chrome-extension://${nexId}/source-panel.html`));
    return f && await f.getByRole('button',{name:'检查元素，快捷键 V',exact:true}).isVisible();
  },'NexAlign 实际界面就绪');
  await click(attrs=>'data-floating-launcher' in attrs);
  await until(async()=>{const s=await state();return s.n.menuOpen==='false'&&s.a.suiteAway==='false';},'关闭 NexAlign');
  check(true,'收藏关闭后两个主菜单均可正常打开和关闭');
  await trace('after-peer-save',()=>click(byClass('bar-save')));
  await trace('after-peer-close',()=>frame().locator('.dialog-close').click());
  await source.setViewportSize({width:360,height:480});
  await trace('narrow-save',()=>click(byClass('bar-save')));
  check((await inspect(byClass('panel'))).height<=456,'窄短窗口的收藏表单不超出可视范围');
  await trace('narrow-close',()=>frame().locator('.dialog-close').click());
  await source.setViewportSize({width:1280,height:900});
  await browser.send('Extensions.uninstall',{id:nexId});
  await until(async()=>(await state()).a.suitePaired==='false','仅保留 Aarre');
  await trace('standalone-save',()=>click(byClass('bar-save')));
  await trace('standalone-close',()=>frame().locator('.dialog-close').click());
  check((await aarre.evaluate(url=>chrome.bookmarks.search({url}),url)).length===0,'打开及取消没有写入收藏');
  const signatures = (entry, part) => [...new Set(entry.frames.flatMap(f=>f[part]).map(t=>JSON.stringify(t)))].sort();
  check(report['main-open'].frames.some(f=>f.surface.some(a=>a.duration===280)) && report['main-close'].frames.some(f=>f.surface.some(a=>a.duration===210)), '主菜单实际运行共享的 280ms 展开、210ms 收起动画');
  for (const [name, entry] of Object.entries(report)) {
    if (!entry?.frames) continue;
    const opening = name.includes('save') || name === 'main-open';
    const reference = report[opening ? 'main-open' : 'main-close'];
    check(['surface','content'].every(part=>JSON.stringify(signatures(entry,part))===JSON.stringify(signatures(reference,part))),name+'：底板及内容动画的时长、延迟和缓动与主菜单一致');
    const expandedWidth=Math.max(...entry.frames.map(f=>f.w));
    check(entry.frames.some(f=>f.w>53&&f.w<expandedWidth-1)&&entry.frames.some(f=>f.opacity>0&&f.opacity<1),name+'：存在连续形变和内容淡入淡出中间帧');
    if (name.includes('save')) {
      const finalHeight=entry.frames.at(-1).ph;
      const visible=entry.frames.filter(f=>f.visible&&f.opacity>0);
      check(visible.length>0&&visible.every(f=>Math.abs(f.ph-finalHeight)<1),name+'：从加载到内容就绪外框尺寸始终稳定');
      const clicked=entry.events.find(e=>e.type==='LAUNCHER_POINTER_DOWN');
      const started=entry.frames.find(f=>f.t>=clicked.t&&f.surface.length>0);
      const first=entry.frames.find(f=>f.t>=clicked.t&&f.w>53);
      entry.animationStartMs=started.t-clicked.t;
      entry.firstMotionMs=first.t-clicked.t;
      // Track scheduling and the first composited geometry separately. Chrome
      // can present the unchanged initial keyframe before its next paint.
      check(entry.animationStartMs<100&&entry.firstMotionMs<150,name+'：点击后及时启动动画并绘制首个变化帧',{start:entry.animationStartMs,firstPaint:entry.firstMotionMs});
      if(name==='cold-save') {
        const accepted=entry.events.find(e=>e.type==='FLOAT_SAVE_ACCEPTED');
        check(accepted.t-first.t>=2200&&entry.frames.some(f=>f.visible&&f.opacity===1&&f.loading),name+'：读取延迟超过两秒期间已完整展开加载面板');
      }
      check(entry.layers?.every(layer=>layer.opacity===1&&layer.animation==='none'&&layer.transform==='none'),name+'：内层保持不透明，不额外叠加动画或透出首页');
    } else if (!opening) {
      const closed=entry.events.find(e=>e.type==='FLOAT_CLOSE');
      const last=entry.frames.at(-1);
      check(last.w===52&&!last.visible,name+'：统一收起动画结束后只保留手柄');
      if(name!=='main-close') {
        const acknowledged=entry.events.find(e=>e.type==='FLOAT_CLOSED');
        check(entry.retainedDuringClose&&acknowledged&&acknowledged.t-closed.t>=200,name+'：表单保留到收起完成后清理');
      }
    }
  }
  }
  check(report.errors.length===0,'未记录到页面运行异常');
  report.video=await source.video().path();
} catch(error) {report.error=error.stack;console.error(error);process.exitCode=1;await context?.pages()[0]?.screenshot({path:path.join(artifact,'error.png')}).catch(()=>{});}
finally {
  clearTimeout(deadline);
  await writeFile(path.join(artifact,'report.json'),JSON.stringify(report,null,2));
  await context?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await rm(profile,{recursive:true,force:true});
}

// Run with the existing task space only: ego-browser nodejs < this-file
// Requires Vite at http://127.0.0.1:5173. This is DEV visual evidence, not installed Chrome.
const fs = await import('node:fs/promises');
const t = await taskSpace(5), p = t.page('p1');
const out = '/Users/nefish/Desktop/Coding/Aarre/docs/verification/2026-09-09/';
const settle = () => p.evaluate(async () => {
  const d = window.__aarreHarness?.frame?.document || document;
  await d.fonts.ready;
  // Scroll-driven animations have an auto duration and never finish while a list is open.
  await Promise.allSettled(d.getAnimations().filter(a => a.effect?.getTiming().duration !== 'auto' && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished));
  await new Promise(requestAnimationFrame);
});
const shot = async (name, width = 1440, height = 1000) => {
  await settle(); await p.screenshot({ fullPage: false, clip: { x: 0, y: 0, width, height }, path: out + 'final/' + name + '.png' });
};
await p.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
if (!(await p.evaluate(() => !!window.__aarreHarness?.frame))) await p.click('loc=role:button[name="打开 Aarre 菜单"]');
await p.waitForFunction(() => !!window.__aarreHarness.frame?.document.querySelector('[role=tablist]'));
await p.click('loc=role:tab[name="收藏"]');
await p.waitForFunction(() => !!window.__aarreHarness.frame.document.querySelector('#bookmark-list'));
if (process.env.AARRE_VISUAL_ONLY !== '1') {
const diagnostics = await p.evaluate(async () => {
  const w = window.__aarreHarness.frame, samples = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now(); await new Promise(r => w.setTimeout(r, 140));
    const timerMs = performance.now() - start, frameStart = performance.now();
    await new Promise(r => w.requestAnimationFrame(r));
    samples.push({ timerMs, frameMs: performance.now() - frameStart });
  }
  return { topVisibility: document.visibilityState, frameVisibility: w.document.visibilityState, focus: document.hasFocus(), samples };
});
const samples = [];
for (const q of Array.from({length:20},(_,i)=>['GitHub', 'Figma', 'Anthropic', 'YouTube', 'MDN'][i%5])) {
  await p.evaluate(q => {
    const w = window.__aarreHarness.frame, d = w.document, input = d.querySelector('input[type=search]'), list = d.querySelector('#bookmark-list');
    w.__searchSample = null; let start = 0; const before = list.textContent;
    const handler = () => { start = performance.now(); }; input.addEventListener('input', handler);
    const ob = new MutationObserver(() => {
      if (input.value === q && list.textContent !== before && list.textContent.toLowerCase().includes(q.toLowerCase())) {
        ob.disconnect(); input.removeEventListener('input', handler);
        w.__searchSample = { query: q, domMs: performance.now() - start, characters: list.textContent.length };
      }
    });
    ob.observe(list, { childList: true, characterData: true, subtree: true });
  }, q);
  await p.fill('loc=role:searchbox[name="搜索 Chrome 书签"]', q);
  await p.waitForFunction(() => !!window.__aarreHarness.frame.__searchSample);
  samples.push(await p.evaluate(() => window.__aarreHarness.frame.__searchSample));
}
const old = JSON.parse(await fs.readFile(out + 'search-performance.json', 'utf8'));
const times = samples.map(x => x.domMs).sort((a,b) => a-b);
await fs.writeFile(out + 'search-performance.json', JSON.stringify({
  scope: 'Ego DEV host harness, 309 bookmark fixture; final input event to matching DOM update includes 140ms debounce. Screen paint is a separate measurement.',
  hardware: 'Apple M1 Pro / 32GB / macOS 15.6.1', userAgent: await p.evaluate(() => navigator.userAgent), samples, p95DomMs: times[Math.ceil(times.length*.95)-1],
  paintExperiment: old.paintExperiment || old, diagnostics,
  verdict: 'DOM timing and paint timing are separate. Earlier displayed-frame experiment exceeded 200ms. Installed Chrome paint performance remains open; no claimed full performance pass.'
}, null, 2));
console.log({ searchDomP95Ms: times[Math.ceil(times.length*.95)-1], diagnostics });
}
// Tailwind's development content watcher may reload the harness after evidence JSON changes.
await p.goto('http://127.0.0.1:5173/docs/verification/2026-09-09/host-harness.html');
await p.click('loc=role:button[name="打开 Aarre 菜单"]');
await p.waitForFunction(()=>!!window.__aarreHarness.frame?.document.querySelector('[role=tablist]'));
if(await p.evaluate(()=>!!window.__aarreHarness.frame.document.querySelector('input[type=search]')?.value))await p.click('loc=role:button[name="清空搜索"]');
if(await p.evaluate(()=>window.__aarreHarness.frame.frameElement.getRootNode().querySelector('.panel').hidden))await p.click('loc=role:button[name="打开 Aarre 菜单"]');
for (const theme of ['dark', 'light']) {
  await p.click('loc=role:tab[name="设置"]');
  await p.waitForFunction(() => !!window.__aarreHarness.frame.document.querySelector('input[aria-label="深色模式"]'));
  if (await p.evaluate(theme => window.__aarreHarness.frame.document.documentElement.dataset.theme !== theme, theme)) await p.press('loc=role:switch[name="深色模式"]', 'Space');
  await p.evaluate(() => { window.__aarreHarness.frame.document.querySelector('.settings-page-content').scrollTop = 0; });
  await shot('floating-settings-' + theme);
  await p.click('loc=role:tab[name="AI"]');
  await p.waitForFunction(() => !!window.__aarreHarness.frame.document.querySelector('.agent-chat-welcome'));
  await shot('floating-ai-' + theme);
  await p.click('loc=role:tab[name="收藏"]');
  await p.waitForFunction(() => !!window.__aarreHarness.frame.document.querySelector('#bookmark-list'));
  await shot('host-desktop-' + theme);
}
const geometry = [];
for (const width of [360, 420, 1280, 1440]) {
  const height = width < 500 ? 640 : 1000;
  await p.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const data = await p.evaluate(() => {
    const w=window.__aarreHarness.frame, d=w.document, root=w.frameElement.getRootNode();
    const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
    return { viewport:{width:visualViewport.width,height:visualViewport.height},ball:rect(root.querySelector('.ball')),menu:rect(root.querySelector('.panel')),iframe:{width:d.documentElement.clientWidth,scrollWidth:d.documentElement.scrollWidth},tabs:rect(d.querySelector('.floating-nav')) };
  });
  geometry.push({ requestedWidth:width, ...data });
  if (width < 500) await shot(width === 360 ? 'host-narrow-light' : 'host-420-light', width, height);
}
await p.cdp('Emulation.setDeviceMetricsOverride',{width:360,height:640,deviceScaleFactor:1,mobile:false});
await p.press('loc=role:button[name="编辑 Anthropic — AI 与自动化"]','Enter');
await p.waitForFunction(()=>!!window.__aarreHarness.frame.document.querySelector('[role=dialog]'));
await p.click('loc=css:.aarre-select-trigger');
await p.waitForFunction(()=>!!window.__aarreHarness.frame.document.querySelector('[role=listbox]'));
await shot('folder-select-narrow',360,640);
await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
await fs.writeFile(out+'narrow-geometry.json',JSON.stringify(geometry,null,2));
console.log('floating screenshots and geometry complete');
console.log((await p.snapshot({scope:'full_page'})).slice(0,1700));

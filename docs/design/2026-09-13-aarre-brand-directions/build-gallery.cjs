(function () {
  const { readFileSync, writeFileSync } = require('node:fs');
  const { join } = require('node:path');
  const base = __dirname;
  const previous = JSON.parse(readFileSync(join(base, 'directions.json'), 'utf8')).filter(v => Number(v.id) <= 4);
  const addition = JSON.parse(readFileSync(join(base, 'prompts-05-10.json'), 'utf8'));
  const added = addition.variants.map(({ prompt, ...v }) => v);
  const variants = [...previous, ...added];
  const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const mark = id => Number(id) > 4 ? '<em class="new">新增</em>' : '';
  const original = readFileSync(join(base, 'index.html'), 'utf8');
  const css = original.match(/<style>([\s\S]*?)<\/style>/)[1].split('/* Ten direction gallery */')[0];
  const additions = `/* Ten direction gallery */
.nav-links{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:18px;font-size:12px}
.nav-links a{white-space:nowrap;padding:8px 0}.nav-links a:hover{color:var(--ink)}
.brand{flex-shrink:0}.intro{max-width:850px;font-size:15px}.card-caption{gap:14px}
.new{font-size:10px;color:#6c745e;font-style:normal;font-weight:500;letter-spacing:.04em;margin-left:4px;vertical-align:middle}
.jump-new{display:inline-block;margin-top:16px;font-size:13px;text-decoration:underline;text-underline-offset:5px}
@media(max-width:1000px){.nav-links{gap:12px;font-size:11px}}
@media(max-width:760px){html{scroll-padding-top:136px}.nav-inner{display:block;padding-top:12px;padding-bottom:8px}.brand{display:inline-block;margin-bottom:7px}.nav-links{grid-template-columns:repeat(5,minmax(0,1fr));gap:0 12px;font-size:12px}.nav-links a{padding:6px 0}.intro{font-size:14px}.card-caption{gap:10px}.card-caption b{font-size:15px}}
`;
  const nav = variants.map(v => `<a href="#direction-${v.id}">${v.id} ${escape(v.name)}</a>`).join('');
  const cards = variants.map(v => `<a class="card" href="#direction-${v.id}"><img src="${v.id}-${v.slug}.png" alt="${escape(v.name)}品牌视觉总览" width="1536" height="1024"><span class="card-caption"><b>${v.id} / ${escape(v.name)} ${mark(v.id)}</b><span>${escape(v.subtitle)}</span><i aria-hidden="true">↗</i></span></a>`).join('\n');
  const sections = variants.map(v => `<section class="direction" id="direction-${v.id}">
<div class="direction-heading"><div><span class="eyebrow">DIRECTION ${v.id}</span> ${mark(v.id)}<h2>${escape(v.name)}</h2><p class="lead">${escape(v.lead)}</p><p class="description">${escape(v.detail)}</p></div><a class="original" href="${v.id}-${v.slug}.png" target="_blank" rel="noopener">查看原始图稿 ↗</a></div>
<a class="board" href="${v.id}-${v.slug}.png" target="_blank" rel="noopener" aria-label="打开${escape(v.name)}完整图稿"><img src="${v.id}-${v.slug}.png" alt="Aarre ${escape(v.name)}完整品牌视觉：标志、字体、配色、品牌图形与产品应用示意" width="1536" height="1024" loading="lazy"></a>
</section>`).join('\n');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aarre · 十套品牌视觉提案</title><style>${css}${additions}</style></head>
<body><nav><div class="shell nav-inner"><a class="brand" href="#top">Aarre</a><div class="nav-links">${nav}</div></div></nav>
<main class="shell" id="top"><header><span class="eyebrow">BRAND DIRECTIONS / 2026.09.13</span><h1>十套品牌视觉提案</h1><p class="intro">01–04 为首轮，05–10 为本轮新增。每套包含标志、字标、配色、字体和产品应用示意。</p><a class="jump-new" href="#direction-05">直接查看新增六套 ↗</a></header>
<div class="overview">${cards}</div>${sections}
<footer><span>由生图工具生成的品牌概念提案 · 图中界面为应用示意，尚未替换产品。</span><span><a href="prompts.json">生成描述</a> · <a href="README.md">交付说明</a> · <a href="#top">回到总览 ↑</a></span></footer></main></body></html>`;
  writeFileSync(join(base, 'index.html'), html);
  writeFileSync(join(base, 'directions.json'), JSON.stringify(variants, null, 2)+'\n');
  const promptRecord = JSON.parse(readFileSync(join(base, 'prompts.json'), 'utf8'));
  promptRecord.variants = [...promptRecord.variants.filter(v => Number(v.id) <= 4), ...addition.variants];
  promptRecord.updated = addition.created;
  writeFileSync(join(base, 'prompts.json'), JSON.stringify(promptRecord, null, 2)+'\n');
  const rows = variants.map(v => `| ${v.id} | ${v.name} | ${v.subtitle} | [PNG](${v.id}-${v.slug}.png) |`).join('\n');
  writeFileSync(join(base,'README.md'), `# Aarre · 十套品牌视觉提案

2026-09-13。首轮四套完整保留，本轮新增 05–10 六套。各套独立设计，用于比较品牌气质。

[打开十套对比页](index.html) · [直接查看新增六套](index.html#direction-05)

| 编号 | 方向 | 气质 | 原始图稿 |
| --- | --- | --- | --- |
${rows}

每套涵盖标志与字标、字体与配色、品牌图形，以及浏览器收藏界面的应用示意。图中产品界面是概念设计；字体和标志在选定方向后仍需整理为实际可用资产。

生成方式：内置 \`image_gen.imagegen\`，每套单独调用，共十张完整品牌图。全部提示词保存在 [prompts.json](prompts.json)，本轮六套另存于 [prompts-05-10.json](prompts-05-10.json)，来源、尺寸和校验信息记录在 [outputs.json](outputs.json)。图稿保留工具原始输出，未使用代码重绘。

当前阶段：供用户选择完整品牌方向，尚未替换插件资产。
`);
  console.log('Gallery ready: '+variants.length+' directions.');
})();

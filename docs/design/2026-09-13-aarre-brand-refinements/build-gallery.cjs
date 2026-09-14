(function(){
  const {readFileSync,writeFileSync,copyFileSync}=require('node:fs');
  const {join}=require('node:path');
  const base=__dirname;
  const variants=JSON.parse(readFileSync(join(base,'prompts.json'),'utf8')).variants;
  const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const families=[
    {key:"cabinet",id:"A",name:"拾集",original:"03",summary:"保留橘红、淡紫和三枚不规则块面，比较更紧凑与更完整的图形结构。"},
    {key:"current",id:"B",name:"回流",original:"02",summary:"保留钴蓝与 a 形回环，比较清晰的几何秩序和更流畅的运动感。"},
    {key:"grove",id:"C",name:"林间",original:"05",summary:"保留松绿、嫩黄与有机回环，比较向上的生长感和安静的围合感。"}
  ];
  for(const family of families){
    family.variants=variants.filter(v=>v.family===family.key);
    family.reference=`reference-${family.key}.png`;
    copyFileSync(family.variants[0].reference,join(base,family.reference));
  }
  const familySections=families.map(f=>`<section class="family" id="${f.key}">
    <div class="family-intro">
      <a class="reference" href="${f.reference}" target="_blank" rel="noopener"><img src="${f.reference}" alt="${f.name}原方向，首轮编号${f.original}" width="1536" height="1024"><span>原方向 ${f.original} · ${f.name} <i aria-hidden="true">↗</i></span></a>
      <div class="family-copy"><span class="eyebrow">FAMILY ${f.id} / TWO DEVELOPMENTS</span><h2>${f.name}</h2><p>${f.summary}</p><span class="hint">下方两套为新延展，点击图稿查看原尺寸。</span></div>
    </div>
    <div class="variants">${f.variants.map(v=>`<article id="${v.id}"><a class="board" href="${v.file}" target="_blank" rel="noopener" aria-label="查看 ${v.id} ${v.familyName} ${v.name}完整图稿"><img src="${v.file}" alt="${v.id} · ${v.familyName} / ${v.name}品牌视觉延展" width="1536" height="1024"></a><div class="caption"><h3><span>${v.id}</span> ${v.name}</h3><a href="${v.file}" target="_blank" rel="noopener" aria-label="查看 ${v.id} 原图">↗</a></div><p class="lead">${v.lead}</p><p class="detail">${v.detail}</p></article>`).join('\n')}</div>
  </section>`).join('\n');
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aarre · 拾集、回流、林间 · 六套品牌延展</title>
<style>
:root{color-scheme:light;--bg:#eeeee8;--ink:#272924;--muted:#686c62;--line:#d4d7cd}*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:90px}
body{margin:0;color:var(--ink);background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}a:focus-visible{outline:2px solid #5c6750;outline-offset:5px}
.shell{max-width:1520px;margin:auto;padding:0 40px}
nav{position:sticky;top:0;z-index:2;background:rgba(238,238,232,.94);backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}
.nav-inner{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:64px}
.brand{font-size:21px;font-weight:750;letter-spacing:-.8px}.nav-links{display:flex;gap:28px;font-size:13px;color:var(--muted)}.nav-links a{padding:10px 0}
header{padding:52px 0 44px}.eyebrow{font-size:11px;font-weight:600;letter-spacing:.13em;color:var(--muted)}
h1{font-size:clamp(32px,4.2vw,56px);font-weight:600;letter-spacing:-.045em;line-height:1.2;margin:16px 0}
.intro{color:var(--muted);font-size:15px;line-height:1.8;margin:0;max-width:850px;text-wrap:pretty}
.previous{display:inline-block;margin-top:18px;font-size:12px;text-decoration:underline;text-underline-offset:5px;color:var(--muted)}
.family{border-top:1px solid var(--line);padding:32px 0 56px}
.family-intro{display:grid;grid-template-columns:272px minmax(0,1fr);gap:32px;align-items:center;margin-bottom:28px}
.reference{display:block}.reference img{display:block;width:100%;height:auto;outline:1px solid rgba(0,0,0,.07)}
.reference>span{display:flex;align-items:center;justify-content:space-between;padding-top:9px;font-size:11px;color:var(--muted)}i{font-style:normal}
h2{font-size:36px;font-weight:600;letter-spacing:-.03em;margin:10px 0 14px;line-height:1.2}
.family-copy p{font-size:15px;line-height:1.8;margin:0 0 14px;max-width:680px}.hint{font-size:12px;color:var(--muted)}
.variants{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}
.variants article{min-width:0}.board{display:block}.board img{display:block;width:100%;height:auto;aspect-ratio:3/2;object-fit:contain;background:white;outline:1px solid rgba(0,0,0,.07)}
.board:hover img{filter:brightness(.98)}.caption{display:flex;align-items:center;justify-content:space-between;margin-top:16px}
h3{margin:0;font-size:22px;font-weight:600;line-height:1.3;letter-spacing:-.025em}h3 span{font-size:14px;font-weight:500;margin-right:10px;color:var(--muted);font-variant-numeric:tabular-nums}
.caption>a{font-size:24px}.lead{font-size:15px;line-height:1.7;margin:10px 0 6px}.detail{font-size:13px;line-height:1.8;color:var(--muted);margin:0;max-width:630px;text-wrap:pretty}
footer{border-top:1px solid var(--line);padding:26px 0 40px;font-size:12px;color:var(--muted);line-height:1.8;display:flex;justify-content:space-between;gap:24px}footer a{text-decoration:underline;text-underline-offset:4px}
@media(max-width:800px){.shell{padding:0 20px}.nav-links{gap:18px;font-size:12px}header{padding:34px 0 30px}.intro{font-size:14px}.family{padding:26px 0 38px}.family-intro{grid-template-columns:180px minmax(0,1fr);gap:20px}.family-copy h2{font-size:29px}.family-copy p{font-size:13px}.variants{gap:20px}.lead{font-size:14px}.detail{font-size:12px}h3{font-size:20px}}
@media(max-width:600px){.family-intro{grid-template-columns:1fr}.reference{width:200px}.family-copy{grid-row:1}.family-copy h2{font-size:30px}.hint{display:none}.variants{grid-template-columns:1fr;gap:30px}.family-copy p{margin:0}.caption{margin-top:13px}footer{display:block}footer span{display:block;margin-bottom:8px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><nav><div class="shell nav-inner"><a class="brand" href="#top">Aarre</a><div class="nav-links">${families.map(f=>`<a href="#${f.key}">${f.id} · ${f.name}</a>`).join('')}</div></div></nav>
<main class="shell" id="top"><header><span class="eyebrow">BRAND DEVELOPMENT / 2026.09.13</span><h1>三个方向，六套延展</h1><p class="intro">沿拾集、回流、林间继续发展。每组保留原方向作对照，探索标志、字体和产品应用的不同表达。</p><a class="previous" href="../2026-09-13-aarre-brand-directions/index.html">查看此前十套方向 ↗</a></header>${familySections}
<footer><span>生图工具生成的品牌概念 · 原图保留 · 产品界面为应用示意</span><span><a href="prompts.json">生成描述</a> · <a href="README.md">交付说明</a> · <a href="#top">回到顶部 ↑</a></span></footer></main></body></html>`;
  writeFileSync(join(base,'index.html'),html);
  writeFileSync(join(base,'directions.json'),JSON.stringify(variants.map(({prompt,...v})=>v),null,2)+'\n');
  const rows=variants.map(v=>`| ${v.id} | ${v.familyName} · ${v.name} | ${v.subtitle} | [原图](${v.file}) |`).join('\n');
  writeFileSync(join(base,'README.md'),`# Aarre · 三个方向，六套品牌延展

[打开分组对比页](index.html)

2026-09-13。用户选择拾集、回流、林间三个方向继续发展。本轮各生成两套完整品牌延展，原方向保留在每组旁边作对照。

| 编号 | 延展 | 变化 | 图稿 |
| --- | --- | --- | --- |
${rows}

图稿包含标志、字标、配色、字体、图形语言和产品应用示意。所有图稿均为内置 \`image_gen.imagegen\` 生成，分别引用对应原方向的 PNG 作为视觉家族参考；没有用代码重绘图稿。完整提示词与参考路径见 [prompts.json](prompts.json)，输出来源与尺寸见 [outputs.json](outputs.json)。

当前阶段是品牌选型与发展；界面为概念应用，尚未替换现有产品。字标、图标与字体方案在选定后需要整理为实际可用的正式资产。
`);
  console.log('Refinement gallery ready: '+variants.length+' boards, '+families.length+' references.');
})();

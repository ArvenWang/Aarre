import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=new URL('./',import.meta.url), files=(await readdir(new URL('final/',root))).filter(f=>f.endsWith('.png')).sort();
const labels={menu:'收藏菜单',settings:'设置',select:'模型选择',editor:'编辑收藏',folder:'文件夹选择',history:'历史会话',ai:'AI',manager:'完整收藏库',privacy:'隐私页',onboarding:'引导',archive:'本地备份',snapshot:'封面补齐',library:'收藏库',organize:'整理提案',report:'报告',topics:'主题图谱',resurface:'重新发现',filter:'文件夹筛选',nav:'横向导航',note:'长备注',provider:'服务配置',confirm:'确认窗口',delete:'删除确认',empty:'初始状态',long:'长回答',table:'表格',scroll:'滚动',drag:'拖动中',fading:'渐隐中间帧',idle:'闲置',end:'末尾',light:'日间',dark:'夜间'};
const title=file=>file.replace('.png','').split('-').map(word=>labels[word]||(/^[0-9]+$/.test(word)?word+'px':word)).join(' · ');
const figure=(path,label,wide=false)=>`<figure class="${wide?'wide':''}"><a href="${path}" target="_blank" rel="noopener"><img src="${path}" alt="${label}" loading="lazy"></a><figcaption>${label}<small>点击查看原尺寸截图</small></figcaption></figure>`;
const groups=[
 ['01','滚动与渐隐',files.filter(f=>f.startsWith('menu-scroll')),'实际鼠标拖动；中间图暂停真实 CSS 过渡于 40ms，拍摄后恢复播放。'],
 ['02','悬浮菜单与选择',files.filter(f=>/^(menu|settings|select)-/.test(f)&&!f.startsWith('menu-scroll')),'比较宽度、明暗主题、下拉箭头与字段留白。'],
 ['03','编辑与长内容',files.filter(f=>/^(editor|folder|ai|history)-/.test(f)),'窄窗、长备注、长回答与宽表格；这里的 QA 会话没有发送到 AI 服务。'],
 ['04','完整收藏库',files.filter(f=>f.startsWith('manager-')),'五个功能页、窄窗导航、筛选、设置与编辑弹层。'],
 ['05','引导、隐私与确认',files.filter(f=>/^(privacy|onboarding|archive|snapshot)-/.test(f)),'检查正文滚动、窗口边界、字段比例和确认操作。'],
];
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aarre 0.6.1 · 视觉验收</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#202329;background:#f5f5f2;line-height:1.65}*{box-sizing:border-box}body{margin:0}main{max-width:1440px;padding:48px 32px 100px;margin:auto}header{max-width:880px;margin-bottom:40px}.eyebrow{font-size:12px;letter-spacing:.12em;color:#58615d;font-weight:700}h1{font-size:clamp(28px,4vw,48px);line-height:1.2;letter-spacing:-.04em;margin:14px 0 20px}h2{font-size:24px;margin:0}p{color:#59615d}a{color:#216452;text-underline-offset:3px}.facts{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}.facts span{background:#e8eee8;border-radius:6px;padding:7px 12px;font-size:13px}.boundary{border-left:3px solid #708879;padding:8px 16px;font-size:14px}.links{display:flex;gap:20px;flex-wrap:wrap;margin:24px 0}nav{display:flex;flex-wrap:wrap;gap:10px 22px;font-size:14px;border-block:1px solid #dfe2dc;padding:18px 0}section{margin-top:64px;scroll-margin-top:20px}.section-title{display:flex;gap:16px;align-items:baseline}.section-title span{font-size:12px;font-weight:700;color:#697569}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));align-items:start;gap:24px;margin-top:24px}figure{margin:0;min-width:0;border:1px solid #dddeda;border-radius:12px;overflow:hidden;background:white}figure>a{display:flex;justify-content:center;background:#e8e9e5;padding:12px}img{display:block;max-width:100%;height:auto;max-height:760px;object-fit:contain}figcaption{padding:14px 16px;font-size:13px;font-weight:600}small{display:block;color:#798077;font-weight:400;font-size:12px;margin-top:3px}.wide{grid-column:span 2}.wide img{max-height:none}.compare{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}.checklist{background:white;padding:24px;border:1px solid #dddeda;border-radius:12px}.checklist label{display:flex;align-items:start;gap:12px;padding:10px 0;font-size:14px}.checklist input{width:18px;height:18px;accent-color:#23644d;flex:none}footer{margin-top:60px;color:#697569;font-size:13px}@media(max-width:700px){main{padding:28px 16px 60px}.wide{grid-column:auto}.grid{grid-template-columns:1fr}section{margin-top:40px}}
</style><main>
<header><div class="eyebrow">AARRE / 0.6.1 / 2026.09.09</div><h1>Aarre 0.6.1 视觉验收</h1><p>本轮对照 NexAlign，统一悬浮滚动条、下拉留白与控件比例，并修复长内容和弹层中的实际排版问题。</p>
<div class="facts"><span>${files.length} 张最终画面</span><span>5px 悬浮细条</span><span>12px 箭头留白</span><span>明暗主题与窄窗</span></div>
<p class="boundary">这些画面来自实际运行的本地开发预览，使用明确标注的隔离测试数据。它们证明本轮界面和交互检查；已安装 Chrome、真实 AI 与云端仍需独立验收。</p>
<div class="links"><a href="README.md">完整证据记录</a><a href="../../../AGENT_PROGRESS.md">项目进展</a><a href="../../../outputs/Bookmark-Layer-0.6.1.zip">0.6.1 扩展包</a></div></header>
<nav>${groups.map(([id,label])=>`<a href="#g${id}">${label}</a>`).join('')}<a href="#acceptance">电脑端验收</a></nav>
<section><div class="section-title"><span>REFERENCE</span><h2>对照与问题原貌</h2></div><p>NexAlign 图为另一个仓库的存档参考；其余为本轮修复前的实际画面。</p><div class="grid compare">
${figure('before/nexalign-reference.png','NexAlign · 存档参考')}${figure('before/select.png','修复前 · 下拉宽度与文字比例')}${figure('before/ai-long-overflow.png','修复前 · 长回答正文被撑宽')}${figure('before/manager-narrow.png','修复前 · 窄窗头部与按钮留白')}${figure('before/manager-settings.png','修复前 · 管理窗口设置字段挤在一行')}
</div></section>
${groups.map(([id,label,items,note])=>`<section id="g${id}"><div class="section-title"><span>${id}</span><h2>${label}</h2></div><p>${note}</p><div class="grid">${items.map(f=>figure('final/'+f,title(f),/^manager-(library|organize|report|topics|resurface)-/.test(f))).join('')}</div></section>`).join('')}
<section id="acceptance"><div class="section-title"><span>CHECK</span><h2>回到电脑后</h2></div><p>从 0.6.1 解压目录更新扩展并刷新普通网页。下面的勾选只保存在这个图集页面，不会改变产品数据。</p><div class="checklist">
${['收藏、设置和下拉列表滚动时出现细条，停下后渐隐；没有底轨或内容跳动。','拖动细条、使用方向键与 Home/End 都能到达内容两端。','明暗主题下，箭头和选中标记均有留白，文字没有贴边或重叠。','窄菜单里的长备注可以滚动，编辑和取消操作保持可达。','长回答正文正常换行，宽表格和代码只在各自区域内横向滚动。','完整收藏库的设置、备份、编辑和封面补齐确认窗口排版正常。'].map((label,i)=>`<label><input type="checkbox" data-check="${i}"><span>${label}</span></label>`).join('')}
</div></section><footer>截图可逐张打开原图。量测数据和回放脚本位于同一目录；最终构建与哈希身份见 0.6.1 构建清单。未推送、部署或发布到商店。</footer></main>
<script>document.querySelectorAll('[data-check]').forEach(e=>{const key='aarre-ui-061-review-'+e.dataset.check;try{e.checked=localStorage.getItem(key)==='1';e.addEventListener('change',()=>localStorage.setItem(key,e.checked?'1':'0'))}catch{}});</script></html>`;
await writeFile(new URL('index.html',root),html);
console.log({gallery:fileURLToPath(new URL('index.html',root)),screenshots:files.length});

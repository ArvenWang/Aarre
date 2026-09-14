from pathlib import Path
from html import escape
import json
base = Path(__file__).resolve().parent
files = sorted(p.stem for p in (base / 'final').glob('*.png'))
labels = {
 'more-dark':'更多操作 · 设置、历史与新建', 'streaming-partial-light':'流式生成 · 首段已显示，仍可停止', 'streaming-actions-light':'回答完成 · 操作确认先显示具体内容',
 'history-dark':'历史会话窗口 · 夜间', 'history-light':'历史会话窗口 · 日间', 'history-long-light':'21 条历史记录 · 日间', 'history-long-dark':'21 条历史记录 · 夜间',
 'composer-long-dark':'20 行草稿 · 输入区增长后内部滚动', 'conversation-sending-light':'从收藏直接发送 · 生成中', 'conversation-stopped-dark':'停止生成 · 保留已完成内容',
 'conversation-table-end-dark':'宽表格横滚至末尾 · 输入框位置不变', 'select-light':'模型选择 · 日间', 'select-dark':'模型选择 · 夜间',
 'manager-search-focus-light':'搜索聚焦 · 一层外壳', 'manager-filter-light':'文件夹筛选 · 箭头与选中标记留白', 'manager-cover-dialog-light':'封面补齐 · 原有真实任务的确认窗口',
 'manager-settings-light':'完整收藏库设置 · 日间', 'manager-settings-dark':'完整收藏库设置 · 夜间', 'manager-editor-light':'完整收藏库编辑 · 日间', 'manager-editor-dark':'完整收藏库编辑 · 夜间',
 'manager-organize-light':'整理提案 · 操作内容可复查', 'manager-report-light':'报告 · 小圆角周期选择', 'manager-report-dark':'报告 · 夜间', 'manager-topics-light':'主题浏览 · 字段与控件', 'manager-resurface-light':'重新发现 · 阅读资料',
 'scroll-drag':'鼠标拖动 · 无底轨的细滚动条', 'scroll-fading':'淡出中间帧 · 真实过渡暂停于 40ms', 'scroll-idle':'静止后隐藏 · 内容宽度不变',
 'host-desktop-light':'网页中的实际悬浮菜单 · 日间', 'host-desktop-dark':'网页中的实际悬浮菜单 · 夜间', 'host-420-light':'窄窗宿主 · 菜单与浮球保持可达',
}
for n in files:
 if n in labels: continue
 words=n.split('-'); mode={'light':'日间','dark':'夜间'}.get(words[-1],words[-1]);size=next((w+'px' for w in words if w.isdigit()),'')
 kind='当前界面'
 for prefix,title in [('editor-note','长备注编辑'),('editor','编辑收藏'),('delete','菜单删除确认'),('settings','紧凑设置窗口'),('menu','收藏与常驻输入框'),('conversation','直接对话与长回答'),('manager-delete','完整收藏库删除确认'),('manager','完整收藏库')]:
  if n.startswith(prefix+'-'):kind=title;break
 labels[n]=' · '.join(filter(None,[kind,size,mode]))
def fig(n):
 label=labels[n];return f'<figure><a href="final/{n}.png" target="_blank" rel="noopener"><img src="final/{n}.png" alt="{escape(label)}"></a><figcaption>{escape(label)}<small>打开原尺寸截图</small></figcaption></figure>'
def grid(names):return '<div class="grid">'+''.join(fig(n) for n in names if n in files)+'</div>'
featured=['menu-400-light','conversation-400-light','menu-400-dark','conversation-400-dark']
keydetails=['select-light','select-dark','settings-320-light','settings-320-dark','delete-320-light','delete-320-dark','manager-search-focus-light','manager-delete-320-dark']
shown=set(featured+keydetails)
groups=[('更多窗口与窄尺寸',[n for n in files if n.startswith(('menu-','settings-','select-','more-','editor-','delete-')) and n not in shown]),('对话、流式、历史与多行输入',[n for n in files if n.startswith(('conversation-','streaming-','history-','composer-')) and n not in shown]),('完整收藏库与其他功能',[n for n in files if n.startswith('manager-') and n not in shown]),('悬浮宿主与滚动过程',[n for n in files if n.startswith(('host-','scroll-'))])]
html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aarre 0.6.2 · 单一对话工作区</title><style>
:root{font-family:system-ui,-apple-system,"PingFang SC",sans-serif;color:#1b2225;background:#f5f6f6;line-height:1.65}*{box-sizing:border-box}body{margin:0}main{max-width:1160px;margin:auto;padding:40px 28px 80px}h1{font-size:clamp(28px,4vw,44px);line-height:1.25;letter-spacing:-.04em;margin:12px 0 16px}h2{font-size:22px;line-height:1.35;margin:0 0 8px}p{color:#58616a;max-width:820px}a{color:#087b70;text-underline-offset:3px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em}.tags,.links{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}.tags span{background:#e8efec;border-radius:6px;padding:6px 10px;font-size:13px}.boundary{border-left:2px solid #92ada5;padding-left:16px;font-size:13px}section{margin-top:48px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:24px 0}figure{margin:0;background:white;border:1px solid #e0e4e3;border-radius:12px;overflow:hidden;min-width:0}figure>a{display:flex;justify-content:center;background:#eaedeb;padding:12px}img{display:block;max-width:100%;height:auto;max-height:640px;object-fit:contain}figcaption{padding:14px 16px;font-size:14px;font-weight:600}small{display:block;font-size:12px;color:#68717a;font-weight:400;margin-top:4px}details{border-top:1px solid #dfe4e1;padding:20px 0}summary{cursor:pointer;font-weight:650}details .grid{margin-bottom:8px}.links a{font-size:14px}.checks{background:white;border:1px solid #e0e4e3;border-radius:12px;padding:16px 20px}.checks label{display:flex;gap:12px;align-items:start;padding:9px 0;font-size:14px}.checks input{margin-top:6px;accent-color:#087b70}footer{margin-top:40px;font-size:13px;color:#68717a}@media(max-width:700px){main{padding:28px 16px 56px}.grid{grid-template-columns:1fr}.links{gap:10px 18px}section{margin-top:36px}}
</style><main><header><div class="eyebrow">AARRE / 0.6.2 / 按 14 条批注修订</div><h1>一个工作区，直接开始对话。</h1><p>收藏在上方，输入框常驻底部。对话直接展开在菜单中；设置、历史与新会话放进更多菜单。下面默认展示的是本次最新画面。</p>'''
html+=f'<div class="tags"><span>移除 AI / 设置 Tabs</span><span>保留草稿与连续对话</span><span>{len(files)} 张当前画面</span><span>明暗主题 / 320–560px</span></div>'
html+='''<p class="boundary">这是实际产品组件的本地浏览器验收，收藏与 QA 会话为隔离测试数据。真实 AI 服务、原生 Chrome 写操作及云端未在这里冒充已验收；正式安装请使用 0.6.2 解压目录。</p><div class="links"><a href="README.md">14 条批注与验证对账</a><a href="visual-review.json">逐图审核记录</a><a href="../../../outputs/Bookmark-Layer-0.6.2-unpacked">0.6.2 解压加载目录</a><a href="../../../outputs/Bookmark-Layer-0.6.2.zip">扩展 ZIP</a></div></header>'''
html+='<section><h2>打开即可输入，对话沿用同一输入框</h2><p>从收藏发送问题后，上方切换为当前对话。返回收藏、打开设置与继续追问时，输入框和草稿保持连续。</p>'+grid(featured)+'</section>'
html+='<section><h2>这次修正的细节</h2><p>下拉值垂直居中，箭头与选中标记留出空间；字段标签单独一行。搜索只绘制一层外壳，删除说明与操作按钮分两行排放。</p>'+grid(keydetails)+'</section>'
html+='<section><h2>其他当前画面</h2><p>宽度、长内容、流式过程与完整收藏库的补充检查收在下面，按需展开。</p>'
for label,names in groups:
 if names:html+=f'<details><summary>{label} · {len(names)} 张</summary>'+grid(names)+'</details>'
html+='</section><section><h2>回到电脑后可以这样验收</h2><p>更新扩展后刷新普通网页，再打开悬浮菜单。以下勾选只保存在这个验收页中。</p><div class="checks">'
checks=['打开菜单即见底部输入框，没有收藏 / AI / 设置切页。','先输入问题再打开设置，关闭设置后草稿仍然保留。','连接自己的服务后，验证逐步生成、停止、连续追问与历史恢复。','拖动菜单及缩放窗口，检查正文不横溢出，表格和代码在块内滚动。','滚动时出现细条，停止后渐隐；输入框与底部按钮不被挤出窗口。','检查明暗主题、下拉框、编辑与删除确认，再检查完整收藏库的搜索和筛选。']
for i,c in enumerate(checks):html+=f'<label><input type="checkbox" data-check="{i}"><span>{c}</span></label>'
html+='</div></section><section><details><summary>历史记录与参考（不是当前交付图）</summary><p><a href="../2026-09-09-ui-refinement/index.html">0.6.1 历史图集与 NexAlign 存档参考</a>。上一轮的“视觉通过”不代表用户认可，本轮以 14 条批注和当前图集为准。</p></details></section><footer>构建与校验身份以 0.6.2 构建清单为准。没有推送、合并、部署或商店发布。</footer></main><script>document.querySelectorAll("[data-check]").forEach(e=>{let k="aarre-062-review-"+e.dataset.check;try{e.checked=localStorage.getItem(k)==="1";e.addEventListener("change",()=>localStorage.setItem(k,e.checked?"1":"0"))}catch{}})</script></html>'
(base/'index.html').write_text(html)
(base/'image-labels.json').write_text(json.dumps(labels,ensure_ascii=False,indent=2)+'\n')
print(f'Gallery contains {len(files)} current screenshots')

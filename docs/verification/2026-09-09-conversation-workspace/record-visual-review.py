"""Seal the images after individual image-tool inspection; this is not an automatic visual test."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import struct

base = Path(__file__).resolve().parent
labels = json.loads((base / 'image-labels.json').read_text())
notes = [
    ('host-', '宿主与菜单边界完整，正文宽度不因展开而改变，底部输入与浮球可达'),
    ('scroll-', '自制细条无底轨，拖动和渐隐过程对应实际浏览器过渡；静止图不显示滚动条'),
    ('streaming-', '首段生成即可阅读；完成后的操作摘要显示具体内容与展开箭头'),
    ('conversation-', '同一菜单直接对话，正文换行，宽表格和代码限制在所属块内，输入框常驻'),
    ('history-', '历史作为辅助窗口，长列表独立滚动，标题和关闭操作清楚'),
    ('composer-', '长草稿受高度上限约束，内部可滚动，底部操作没有被挤出'),
    ('select-', '文字与选中标记垂直居中，箭头留白，没有粗选中环'),
    ('settings-', '字段标签另行，模型与输入比例一致，章节留白统一，开启开关使用亮色拇指'),
    ('editor-', '窄窗字段和长备注可读，输入单线焦点，操作区固定可达'),
    ('delete-', '删除说明在上，取消和确认同排在下，窄窗不挤压'),
    ('manager-delete-', '删除说明完整，危险操作和取消同排，320px 下按钮仍在窗口内'),
    ('manager-search-', '只有搜索外壳绘制一层边缘，内部输入没有重复阴影或圆角'),
    ('manager-filter-', '小圆角选择控件，箭头与选中标记保留合理间距'),
    ('manager-settings-', '共享设置字段继承完整样式，标签另行，主题开关拇指亮色'),
    ('manager-editor-', '标题、正文和操作区清楚分开，标签与字段间距完整'),
    ('manager-cover-', '补齐封面入口使用统一按钮，真实任务确认内容可读'),
    ('manager-', '布局与文字比例一致，搜索筛选使用小圆角，窄窗工具组整齐，封面完成绘制'),
    ('more-', '设置、历史和新建收于共享菜单，图标与标签留白一致'),
    ('menu-', '无收藏、AI、设置 Tab，无整行收藏主按钮，底部输入框直接可用'),
]
entries = []
for path in sorted((base / 'final').glob('*.png')):
    data = path.read_bytes()
    width, height = struct.unpack('>II', data[16:24])
    entries.append({
        'path': str(path.relative_to(base)), 'title': labels[path.stem],
        'width': width, 'height': height, 'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(), 'reviewed': True,
        'method': 'Individual image-tool inspection of the actual Ego Browser screenshot',
        'note': next(note for prefix, note in notes if path.stem.startswith(prefix)),
    })
result = {
    'version': '0.6.2', 'reviewedAt': datetime.now(timezone.utc).isoformat(),
    'count': len(entries),
    'scope': 'Local DEV runtime and explicit QA data; not installed Chrome, a real AI provider, or user acceptance.',
    'excluded': ['logs/manager-dark-before-image-settle.png: early incomplete paint, replaced after actual theme-button interaction and visible-image decode.'],
    'entries': entries,
}
(base / 'visual-review.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(f'Sealed {len(entries)} individually reviewed screenshots; hashes identify the inspected files.')

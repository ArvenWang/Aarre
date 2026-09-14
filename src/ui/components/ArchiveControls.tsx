import { useEffect, useRef, useState } from "react";
import { Download, Upload, FolderCheck, FileCheck2 } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { FluidInput } from "@/ui/components/ui/input";
import { downloadAarreDataExport } from "../../lib/data-export";
import { parseArchive, MAX_ARCHIVE_BYTES, type AarreArchive, type ArchivePreview } from "../../lib/archive-format";
import { restoreArchive, abandonArchiveRestore } from "../../lib/archive-restore";
import { ARCHIVE_ACTIVE_KEY } from "../../lib/archive-guard";
import { sendExtensionRequest } from "../../lib/messages";
export function ArchiveControls({ onBusyChange, onRestored }: { onBusyChange?: (busy: boolean) => void; onRestored?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ archive: AarreArchive; preview: ArchivePreview; filename: string } | null>(null);
  const [interrupted, setInterrupted] = useState(false), [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
  useEffect(() => { void chrome.storage.local.get(ARCHIVE_ACTIVE_KEY).then((stored) => {
    if (stored[ARCHIVE_ACTIVE_KEY]) { setInterrupted(true); setStatus("有一份备份尚未恢复完成。请选择同一文件继续；期间云同步暂停。"); }
  }); }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); onBusyChange?.(true); setError("");
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "操作未完成，请重试。"); }
    finally { setBusy(false); onBusyChange?.(false); setInterrupted(Boolean((await chrome.storage.local.get(ARCHIVE_ACTIVE_KEY))[ARCHIVE_ACTIVE_KEY])); }
  }
  return <section className="archive-controls" aria-label="本地备份与恢复">
    <p>在当前设备导出完整备份，或从另一台设备恢复。文件包含收藏目录、备注、图片、AI 会话与隐私排除规则，请妥善保管。</p>
    <div className="archive-actions">
      <Button variant="primary" leadingIcon={Download} disabled={busy} onClick={() => void run(async () => { setStatus("正在校验并打包…"); const result = await downloadAarreDataExport(); setStatus(`已生成 ${result.filename}（${(result.bytes / 1024 / 1024).toFixed(1)} MB）`); })}>导出完整备份</Button>
      <Button variant="tertiary" leadingIcon={Upload} disabled={busy} onClick={() => input.current?.click()}>选择备份文件</Button>
      <FluidInput ref={input} className="visually-hidden" tabIndex={-1} aria-label="选择 Aarre 备份文件" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        setSelected(null);
        void run(async () => { if(file.size > MAX_ARCHIVE_BYTES) throw new Error("备份超过 512 MB。"); setStatus("正在校验备份及每张图片…"); const result = await parseArchive(await file.text()); setSelected({ ...result, filename: file.name }); setStatus("文件与图片校验通过，尚未修改收藏。"); });
      }}/>
    </div>
    {selected && <div className="archive-preview">
      <div className="archive-preview-heading"><FileCheck2 size={20}/><strong>{selected.filename}</strong></div>
      <dl>{[["书签",selected.preview.bookmarks],["文件夹",selected.preview.folders],["智能收藏",selected.preview.resources],["图片记录",selected.preview.images],["AI 会话",selected.preview.conversations]].map(([label,count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
      <p>恢复到独立文件夹，保留文件内的目录、顺序和同网址的多处收藏。已有收藏的备注与标签优先保留；重复导入此文件会继续未完成的进度或显示已恢复。</p>
      <p>账号、API Key、同步授权、旧设备的待执行操作不会恢复。AI 会话保留文字历史，其中旧操作按钮不会重新执行。报告由恢复后的收藏重新计算。</p>
      {selected.preview.unsupportedUrls > 0 && <p role="status">有 {selected.preview.unsupportedUrls} 条脚本或不支持的网址将跳过。</p>}
      <Button variant="primary" leadingIcon={FolderCheck} disabled={busy} onClick={() => void run(async () => {
        const result = await restoreArchive(selected.archive, setStatus);
        setStatus(result.alreadyRestored ? "这份备份已经恢复，无需重复导入。" : `恢复完成：${result.created} 个书签和文件夹${result.skipped ? `，跳过 ${result.skipped} 条不支持的网址` : ""}。`);
        setSelected(null);
        await sendExtensionRequest({ type: "IMPORT_NATIVE_BOOKMARKS" });
        onRestored?.();
      })}>{busy ? "正在恢复…" : "确认恢复到新文件夹"}</Button>
    </div>}
    {interrupted && <div className="archive-interrupted">
      <p>也可以结束本次恢复，保留已经创建的文件夹和内容，并恢复云同步。之后再次导入会创建另一份独立目录。</p>
      {confirmEnd ? <div className="archive-actions"><Button variant="secondary" disabled={busy} onClick={() => void run(async () => { await abandonArchiveRestore(); setConfirmEnd(false); setStatus("已结束恢复，现有内容已保留。可以选择另一份备份。"); })}>确认结束，保留已恢复内容</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmEnd(false)}>继续恢复</Button></div> : <Button variant="tertiary" disabled={busy} onClick={() => setConfirmEnd(true)}>结束未完成的恢复</Button>}
    </div>}
    {status && <p role="status" aria-live="polite">{status}</p>}
    {error && <p className="archive-error" role="alert">{error}</p>}
  </section>;
}

import { createArchive, MAX_ARCHIVE_BYTES } from "./archive-format";
export { createArchive as createAarreDataExport } from "./archive-format";
export type { AarreArchive as AarreDataExport } from "./archive-format";
export async function downloadAarreDataExport(): Promise<{ filename: string; bytes: number }> {
  const bundle = await createArchive();
  const blob = new Blob([`${JSON.stringify(bundle)}\n`], { type: "application/json" });
  if (blob.size > MAX_ARCHIVE_BYTES) throw new Error("备份超过 512 MB，请分批整理后再导出。");
  const url = URL.createObjectURL(blob);
  const filename = `aarre-backup-${bundle.exportedAt.slice(0,10)}.json`;
  const anchor = document.createElement("a");
  try { anchor.href=url; anchor.download=filename; anchor.rel="noopener"; document.body.append(anchor); anchor.click(); }
  finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 5000); }
  return { filename, bytes: blob.size };
}

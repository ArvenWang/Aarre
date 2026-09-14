import { Button } from "@/ui/components/ui/button";
import { SparklesIcon } from "../../components/Icons";
import type { SaveAiPreviewState } from "../hooks/use-save-ai-preview";

export function SaveAiPreview({ preview, onRetry }: { preview: SaveAiPreviewState; onRetry: () => void }) {
  const loading = preview.status === "loading";
  const ready = preview.status === "ready";
  return <section className="save-ai-preview" aria-label="AI 增强" aria-busy={loading}>
    <div className="save-ai-heading">
      <SparklesIcon aria-hidden="true" />
      <strong>{loading ? "正在 AI 增强" : ready ? preview.reused ? "已有 AI 信息" : "AI 增强完成" : "AI 增强"}</strong>
      {loading && <span className="save-ai-pulse" aria-hidden="true" />}
      {preview.status === "failed" && <Button variant="ghost" size="sm" onClick={onRetry}>重试</Button>}
    </div>
    <div role="status" aria-live="polite">
      {ready ? <>
        <p className="save-ai-summary">{preview.summary}</p>
        <ul className="save-ai-tags" aria-label="AI 标签">{preview.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
      </> : <p className="save-ai-hint">{loading ? "正在生成摘要和标签，可以先填写或保存。" : preview.message}</p>}
    </div>
  </section>;
}

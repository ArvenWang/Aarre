import type {
  BookmarkAgentProgress,
  BookmarkAgentProgressStage
} from "../../../lib/types";
export const AGENT_PROGRESS_STEPS: Array<{
  stage: BookmarkAgentProgressStage;
  label: string;
}> = [
  { stage: "preparing", label: "准备收藏库" },
  { stage: "scanning", label: "分批检查收藏" },
  { stage: "selecting", label: "筛选相关内容" },
  { stage: "thinking", label: "思考回答路径" },
  { stage: "synthesizing", label: "整理并生成回答" },
];

function AgentThinkingSteps({
  progress,
  thinking,
}: {
  progress?: BookmarkAgentProgress;
  thinking?: string[];
}) {
  const completedStages = new Set(progress?.completedStages || []);
  const visibleStages = new Set(progress?.stages || ["preparing"]);
  const visibleSteps = AGENT_PROGRESS_STEPS.filter((step) =>
    visibleStages.has(step.stage),
  );
  const statusLabel = progress?.label || "正在准备收藏库";
  return (
    <div
      className="agent-thinking-steps"
      role="status"
      aria-live="polite"
      aria-label={statusLabel}
    >
      {visibleSteps.map((step, index) => {
        const thinkingSteps =
          step.stage === "thinking" && thinking?.length
            ? thinking
            : null;
        const state = thinkingSteps
          ? "done"
          : completedStages.has(step.stage)
            ? "done"
            : step.stage === progress?.stage || (!progress && index === 0)
              ? "current"
              : "pending";
        return (
          <div
            className="agent-thinking-step"
            data-state={state}
            key={step.stage}
          >
            <span className="agent-thinking-step-mark" aria-hidden="true">
              {state === "done" ? "✓" : state === "current" ? "•" : ""}
            </span>
            {thinkingSteps ? (
              <ol className="agent-thinking-path">
                {thinkingSteps.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ol>
            ) : (
              <span>{step.label}</span>
            )}
          </div>
        );
      })}
      <small>{statusLabel}</small>
    </div>
  );
}


export { AgentThinkingSteps };

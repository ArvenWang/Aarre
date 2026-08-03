import { Button } from "@/ui/components/ui/button";
import {
  FluidInput,
  FluidTextarea,
  FluidSelect,
} from "@/ui/components/ui/input";
import type { LibraryInsights } from "../../../lib/types";
import { ResourceLink } from "../components/ResourceLink";

interface OrganizeViewProps {
  insights: LibraryInsights | null;
  selectedActionIds: Set<string>;
  selectedActionCount: number;
  confirmDestructiveApply: boolean;
  action: string;
  undoBatchId: string;
  appliedSuccessCount: number;
  appliedFailureCount: number;
  onSelectSafe: () => void;
  onToggleProposal: (actionIds: string[], checked: boolean) => void;
  onApply: () => void;
  onUndo: () => void;
  onOpenResource: (url: string) => void;
}

export function OrganizeView({
  insights,
  selectedActionIds,
  selectedActionCount,
  confirmDestructiveApply,
  action,
  undoBatchId,
  appliedSuccessCount,
  appliedFailureCount,
  onSelectSafe,
  onToggleProposal,
  onApply,
  onUndo,
  onOpenResource,
}: OrganizeViewProps) {
  const proposals = insights?.organizationPlan.proposals || [];
  return (
    <section className="organization-shell">
      <header className="organization-toolbar">
        <div>
          <strong>
            {insights?.organizationPlan.actionableCount || 0} 组可执行建议
          </strong>
        </div>
        <div>
          <Button
            variant="ghost"
            type="button"

            onClick={onSelectSafe}
          >
            全选安全项
          </Button>
          <Button
            type="button"
            variant={confirmDestructiveApply ? "danger" : "primary"}
            disabled={!selectedActionCount || Boolean(action)}
            onClick={onApply}
          >
            {action === "organize"
              ? "执行中…"
              : confirmDestructiveApply
                ? `再次确认：应用 ${selectedActionCount} 项`
                : `应用已选 ${selectedActionCount} 项`}
          </Button>
        </div>
      </header>

      {undoBatchId ? (
        <div className="notice organization-result">
          <span>
            已执行 {appliedSuccessCount} 项；{appliedFailureCount} 项失败。
          </span>
          <Button
            variant="ghost"
            type="button"

            disabled={action === "undo-organize"}
            onClick={onUndo}
          >
            {action === "undo-organize" ? "撤销中…" : "撤销本次整理"}
          </Button>
        </div>
      ) : null}

      {proposals.length ? (
        <div className="proposal-list">
          {proposals.map((proposal) => {
            const actionIds = proposal.actions.map((item) => item.id);
            const selectedCount = actionIds.filter((id) =>
              selectedActionIds.has(id),
            ).length;
            return (
              <article
                className="proposal-card"
                data-destructive={proposal.destructive}
                key={proposal.id}
              >
                <header>
                  {actionIds.length ? (
                    <FluidInput
                      type="checkbox"
                      checked={
                        selectedCount > 0 && selectedCount === actionIds.length
                      }
                      ref={(element) => {
                        if (element) {
                          element.indeterminate =
                            selectedCount > 0 &&
                            selectedCount < actionIds.length;
                        }
                      }}
                      onChange={(event) =>
                        onToggleProposal(actionIds, event.currentTarget.checked)
                      }
                      aria-label={`选择${proposal.title}`}
                    />
                  ) : (
                    <span className="proposal-info-mark">i</span>
                  )}
                  <div>
                    <strong>{proposal.title}</strong>
                    <small>
                      {proposal.destructive
                        ? "包含删除 · 默认不选"
                        : proposal.actions.length
                          ? "可撤销的移动建议"
                          : "仅提示 · 不自动执行"}
                    </small>
                  </div>
                </header>
                <p>{proposal.description}</p>
                <div className="proposal-preview">
                  {proposal.previewLines.slice(0, 12).map((line) => (
                    <code key={line}>{line}</code>
                  ))}
                  {proposal.previewLines.length > 12 ? (
                    <small>
                      另有 {proposal.previewLines.length - 12}{" "}
                      项，将在应用时一并处理
                    </small>
                  ) : null}
                </div>
                {proposal.recoveryLinks?.length ? (
                  <div className="proposal-recovery-links">
                    {proposal.recoveryLinks.map((link) => (
                      <ResourceLink
                        key={link.url}
                        url={link.url}
                        onOpenResource={onOpenResource}
                      >
                        {link.label}
                      </ResourceLink>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <strong>暂无建议</strong>
        </div>
      )}
    </section>
  );
}

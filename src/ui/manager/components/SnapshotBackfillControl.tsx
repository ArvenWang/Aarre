import { Button } from "../../../components/ui/button";
import {
  FluidInput,
  FluidTextarea,
  FluidSelect,
} from "../../components/FluidControls";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { sendExtensionRequest } from "../../../lib/messages";
import type {
  SnapshotBackfillState,
  SnapshotBackfillStatus,
} from "../../../lib/types";
import { CloseIcon } from "../../components/Icons";

interface SnapshotBackfillControlProps {
  missingCount: number;
  onCollectionChanged?: () => void;
}

type SnapshotBackfillAction = "start" | "pause" | "resume" | "cancel" | "";

const DISMISSED_JOB_KEY = "aarre:snapshot-backfill-dismissed-job";
const ACTIVE_STATES: SnapshotBackfillState[] = [
  "running",
  "waiting_focus",
  "paused",
];
const TERMINAL_STATES: SnapshotBackfillState[] = [
  "completed",
  "cancelled",
  "failed",
];

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function isActiveState(state: SnapshotBackfillState): boolean {
  return ACTIVE_STATES.includes(state);
}

function isTerminalState(state: SnapshotBackfillState): boolean {
  return TERMINAL_STATES.includes(state);
}

function statusTimestamp(status: SnapshotBackfillStatus): number {
  const value = Date.parse(
    status.updatedAt || status.completedAt || status.startedAt || "",
  );
  return Number.isFinite(value) ? value : 0;
}

function stateLabel(state: SnapshotBackfillState): string {
  switch (state) {
    case "running":
      return "正在后台补拍";
    case "waiting_focus":
      return "等待前台";
    case "paused":
      return "已暂停";
    case "completed":
      return "已完成";
    case "cancelled":
      return "已取消";
    case "failed":
      return "已中断";
    default:
      return "";
  }
}

function statusMessage(status: SnapshotBackfillStatus): string {
  switch (status.state) {
    case "running":
      if ((status.activeCount || 0) > 1) {
        return `正在后台并发补拍 ${status.activeCount} 个网页`;
      }
      return status.currentTitle
        ? `正在后台补拍“${status.currentTitle}”`
        : "正在准备下一项";
    case "waiting_focus":
      return status.currentTitle
        ? `“${status.currentTitle}”正在等待；请切回专用补拍标签页，并保持 Chrome 窗口在前台。`
        : "请切回专用补拍标签页，并保持 Chrome 窗口在前台。";
    case "paused":
      return "任务已暂停。继续时，Aarre 会重新激活专用补拍标签页。";
    case "completed":
      return status.total
        ? "补拍任务已完成，成功获得的截图会立即用于收藏封面。"
        : "检查完成，当前没有可补拍的网页。";
    case "cancelled":
      return "任务已取消，已经完成的截图会保留。";
    case "failed":
      return "任务意外中断，已经完成的截图会保留；可以从未完成项继续。";
    default:
      return "";
  }
}

export function SnapshotBackfillControl({
  missingCount,
  onCollectionChanged,
}: SnapshotBackfillControlProps) {
  const [status, setStatus] = useState<SnapshotBackfillStatus | null>(null);
  const [candidateCount, setCandidateCount] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [action, setAction] = useState<SnapshotBackfillAction>("");
  const [error, setError] = useState("");
  const [dismissedJobId, setDismissedJobId] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const lastTerminalNotificationRef = useRef("");

  const acceptStatus = useCallback((next: SnapshotBackfillStatus) => {
    if (typeof next.candidateCount === "number") {
      setCandidateCount(next.candidateCount);
    }
    setStatus((current) => {
      if (current && statusTimestamp(next) < statusTimestamp(current)) {
        return current;
      }
      return next;
    });
  }, []);

  const readStatus = useCallback(
    async (includeCandidateCount = false) => {
      try {
        const next = await sendExtensionRequest({
          type: "GET_SNAPSHOT_BACKFILL",
          ...(includeCandidateCount ? { includeCandidateCount: true } : {}),
        });
        if (mountedRef.current) acceptStatus(next);
      } finally {
        if (mountedRef.current) setInitialized(true);
      }
    },
    [acceptStatus],
  );

  useEffect(() => {
    mountedRef.current = true;
    try {
      setDismissedJobId(localStorage.getItem(DISMISSED_JOB_KEY) || "");
    } catch {
      // 本地存储不可用只会让完成提示在刷新后再次出现。
    }
    void readStatus(true).catch(() => undefined);

    const handleStatusUpdate = (message: unknown) => {
      if (
        !message ||
        typeof message !== "object" ||
        (message as { type?: unknown }).type !== "SNAPSHOT_BACKFILL_UPDATED"
      ) {
        return;
      }
      const next = (message as { status?: SnapshotBackfillStatus }).status;
      if (next) acceptStatus(next);
    };
    const runtimeMessageEvent =
      typeof chrome !== "undefined" ? chrome.runtime?.onMessage : undefined;
    runtimeMessageEvent?.addListener(handleStatusUpdate);
    return () => {
      mountedRef.current = false;
      runtimeMessageEvent?.removeListener(handleStatusUpdate);
    };
  }, [acceptStatus, readStatus]);

  useEffect(() => {
    if (!status || !isActiveState(status.state)) return;
    const timer = window.setInterval(() => {
      void readStatus().catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [readStatus, status]);

  useEffect(() => {
    const refreshCandidatesAfterReturning = () => {
      if (
        document.visibilityState === "visible" &&
        (!status || !isActiveState(status.state))
      ) {
        void readStatus(true).catch(() => undefined);
      }
    };
    document.addEventListener(
      "visibilitychange",
      refreshCandidatesAfterReturning,
    );
    window.addEventListener("focus", refreshCandidatesAfterReturning);
    return () => {
      document.removeEventListener(
        "visibilitychange",
        refreshCandidatesAfterReturning,
      );
      window.removeEventListener("focus", refreshCandidatesAfterReturning);
    };
  }, [readStatus, status]);

  useEffect(() => {
    if (!status?.id || !isTerminalState(status.state)) return;
    const notificationKey = `${status.id}:${status.state}:${status.completedAt || status.updatedAt || ""}`;
    if (lastTerminalNotificationRef.current === notificationKey) return;
    lastTerminalNotificationRef.current = notificationKey;
    onCollectionChanged?.();
    void readStatus(true).catch(() => undefined);
  }, [onCollectionChanged, readStatus, status]);

  useEffect(() => {
    if (!confirmOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      confirmButtonRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [confirmOpen]);

  function closeConfirmation() {
    if (action) return;
    setConfirmOpen(false);
    setError("");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleConfirmationKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (action) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function runAction(nextAction: Exclude<SnapshotBackfillAction, "">) {
    if (action) return;
    setAction(nextAction);
    setError("");
    try {
      const next = await sendExtensionRequest({
        type:
          nextAction === "start"
            ? "START_SNAPSHOT_BACKFILL"
            : nextAction === "pause"
              ? "PAUSE_SNAPSHOT_BACKFILL"
              : nextAction === "resume"
                ? "RESUME_SNAPSHOT_BACKFILL"
                : "CANCEL_SNAPSHOT_BACKFILL",
      });
      acceptStatus(next);
      if (nextAction === "start") setConfirmOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "封面补拍操作失败，请稍后重试。",
      );
    } finally {
      if (mountedRef.current) setAction("");
    }
  }

  function dismissStatus() {
    if (!status?.id) return;
    setDismissedJobId(status.id);
    setError("");
    try {
      localStorage.setItem(DISMISSED_JOB_KEY, status.id);
    } catch {
      // 完成状态仍会在当前页面被关闭。
    }
  }

  const showStatus =
    Boolean(status?.id) &&
    status?.state !== "idle" &&
    dismissedJobId !== status?.id;
  const effectiveMissingCount = candidateCount ?? missingCount;

  if (!initialized) return null;
  if (!showStatus && effectiveMissingCount <= 0) return null;

  if (!showStatus) {
    return (
      <>
        <Button
          variant="unstyled"
          ref={triggerRef}
          type="button"
          className="text-button snapshot-backfill-trigger"
          onClick={() => {
            setError("");
            setConfirmOpen(true);
          }}
        >
          补齐缺失封面
        </Button>

        {confirmOpen ? (
          <div
            className="snapshot-backfill-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeConfirmation();
            }}
          >
            <div
              ref={dialogRef}
              className="snapshot-backfill-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="snapshot-backfill-title"
              aria-describedby="snapshot-backfill-description"
              tabIndex={-1}
              onKeyDown={handleConfirmationKeyDown}
            >
              <header>
                <div>
                  <h2 id="snapshot-backfill-title">批量补齐缺失封面</h2>
                  <p>仅处理尚无真实网页截图的收藏。</p>
                </div>
                <Button
                  type="button"
                  variant="unstyled"
                  size="icon-sm"
                  className="snapshot-backfill-dialog-close"
                  aria-label="关闭批量补拍确认"
                  disabled={Boolean(action)}
                  onClick={closeConfirmation}
                >
                  <CloseIcon />
                </Button>
              </header>

              <div className="snapshot-backfill-dialog-body">
                <p id="snapshot-backfill-description">
                  Aarre 将新建一个后台专用标签页，依次打开约{" "}
                  {effectiveMissingCount}{" "}
                  项缺少封面的网页。每一页都会在加载完成并稳定后才截图，不会在刚打开时立即截取。
                </p>
                <div className="snapshot-backfill-foreground-note">
                  <strong>任务在后台运行，不占用当前页面</strong>
                  <span>
                    开始后你可以正常使用
                    Chrome。浏览器可能短暂显示“扩展正在调试此浏览器”提示，这是后台截图所需权限的正常现象。你可以随时暂停或取消，已经完成的截图会保留。
                  </span>
                </div>
                <p className="snapshot-backfill-privacy">
                  此任务只在本机生成网页截图，不调用 AI，也不会上传网页或截图。
                </p>
                {error ? (
                  <p className="snapshot-backfill-error" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>

              <footer>
                <Button
                  variant="unstyled"
                  type="button"
                  className="button button-quiet"
                  disabled={Boolean(action)}
                  onClick={closeConfirmation}
                >
                  暂不补拍
                </Button>
                <Button
                  variant="unstyled"
                  ref={confirmButtonRef}
                  type="button"
                  className="button button-dark"
                  disabled={Boolean(action)}
                  onClick={() => void runAction("start")}
                >
                  {action === "start" ? "正在启动…" : "开始补拍"}
                </Button>
              </footer>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  const currentStatus = status!;
  const latestError = currentStatus.errors.at(-1);
  const canPause = currentStatus.state === "running";
  const canResume = ["waiting_focus", "paused", "failed"].includes(
    currentStatus.state,
  );
  const canCancel = ["running", "waiting_focus", "paused"].includes(
    currentStatus.state,
  );
  const canDismiss = isTerminalState(currentStatus.state);

  return (
    <section
      className="snapshot-backfill-status"
      data-state={currentStatus.state}
      aria-label="封面批量补拍进度"
    >
      <div className="snapshot-backfill-status-heading">
        <div>
          <strong>批量补拍封面</strong>
          <span>{stateLabel(currentStatus.state)}</span>
        </div>
        <b>
          {currentStatus.processed} / {currentStatus.total}
        </b>
      </div>

      <progress
        max={Math.max(1, currentStatus.total)}
        value={Math.min(currentStatus.processed, currentStatus.total)}
        aria-label={`已处理 ${currentStatus.processed} 项，共 ${currentStatus.total} 项`}
      />

      <div className="snapshot-backfill-metrics">
        <span>成功 {currentStatus.succeeded}</span>
        <span>跳过 {currentStatus.skipped}</span>
        <span>失败 {currentStatus.failed}</span>
      </div>

      <p className="snapshot-backfill-current" aria-live="polite">
        {statusMessage(currentStatus)}
      </p>

      {latestError ? (
        <p className="snapshot-backfill-last-error">
          最近失败：{latestError.title} · {latestError.message}
        </p>
      ) : null}
      {error ? (
        <p className="snapshot-backfill-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="snapshot-backfill-actions">
        {canPause ? (
          <Button
            variant="unstyled"
            type="button"
            className="button button-quiet button-small"
            disabled={Boolean(action)}
            onClick={() => void runAction("pause")}
          >
            {action === "pause" ? "正在暂停…" : "暂停"}
          </Button>
        ) : null}
        {canResume ? (
          <Button
            variant="unstyled"
            type="button"
            className="button button-dark button-small"
            disabled={Boolean(action)}
            onClick={() => void runAction("resume")}
          >
            {action === "resume"
              ? "正在继续…"
              : currentStatus.state === "waiting_focus"
                ? "返回并继续"
                : currentStatus.state === "failed"
                  ? "继续未完成项"
                  : "继续"}
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            variant="unstyled"
            type="button"
            className="text-button snapshot-backfill-cancel"
            disabled={Boolean(action)}
            onClick={() => void runAction("cancel")}
          >
            {action === "cancel" ? "正在取消…" : "取消任务"}
          </Button>
        ) : null}
        {canDismiss ? (
          <Button
            variant="unstyled"
            type="button"
            className="button button-quiet button-small"
            onClick={dismissStatus}
          >
            关闭
          </Button>
        ) : null}
      </div>
    </section>
  );
}

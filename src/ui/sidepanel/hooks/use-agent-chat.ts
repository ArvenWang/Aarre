import { useCallback, useEffect, useRef, useState } from "react";
import { sendExtensionRequest } from "../../../lib/messages";
import type {
  AgentChatMessage,
  AgentConversation,
  BookmarkAgentActionProposal,
  BookmarkAgentResponse,
  BookmarkAgentProgress,
  BookmarkAgentProgressStage,
} from "../../../lib/types";
import { AGENT_PROGRESS_STEPS } from "../components/AgentThinkingSteps";

export type SidePanelView = "library" | "settings" | "chat" | "history";

interface UseAgentChatInput {
  busy: string;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  aiConfigured: boolean;
  panelView: SidePanelView;
  setPanelView: (view: SidePanelView) => void;
  refresh: () => Promise<void>;
}

export function useAgentChat({
  busy,
  setBusy,
  setError,
  setNotice,
  aiConfigured,
  panelView,
  setPanelView,
  refresh,
}: UseAgentChatInput) {
  const [prompt, setPrompt] = useState("");
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<AgentConversation | null>(null);
  const activeRequest = useRef("");
  const activeMessage = useRef("");
  const activeExecution = useRef("");
  const activeAgentPort = useRef<chrome.runtime.Port | null>(null);
  const cancelledRequests = useRef(new Set<string>());
  const editingBase = useRef<{ conversationId: string; conversation: AgentConversation } | null>(null);

  const loadConversations = useCallback(async () => {
    const next = await sendExtensionRequest({ type: "GET_AGENT_CONVERSATIONS" });
    const recovered = (Array.isArray(next) ? next : []).map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => message.status === "sending" ? {
        ...message,
        content: "上一次 AI 对话没有完成，请重新提问。",
        status: "cancelled" as const,
        progress: undefined,
      } : message),
    }));
    setConversations(recovered);
    return recovered;
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await sendExtensionRequest({ type: "DELETE_AGENT_CONVERSATION", id });
    setConversations((current) => current.filter((item) => item.id !== id));
    setActiveConversation((current) => current?.id === id ? null : current);
  }, []);

  async function persist(conversation: AgentConversation) {
    const saved = await sendExtensionRequest({
      type: "SAVE_AGENT_CONVERSATION",
      conversation,
    });
    setConversations((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    return saved;
  }

  async function runTurn(conversation: AgentConversation, query: string) {
    if (!query || busy) return;
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const userMessage: AgentChatMessage = {
      id: crypto.randomUUID(), role: "user", content: query, createdAt: timestamp, status: "complete",
    };
    const pendingMessage: AgentChatMessage = {
      id: crypto.randomUUID(), role: "assistant", content: "", createdAt: timestamp, status: "sending",
      progress: {
        requestId, stage: "preparing", stages: ["preparing"], completedStages: [],
        completed: 0, total: 0, label: "正在准备收藏库",
      },
    };
    const pending: AgentConversation = {
      ...conversation,
      title: conversation.messages.length ? conversation.title : query.slice(0, 36),
      updatedAt: timestamp,
      messages: [...conversation.messages, userMessage, pendingMessage],
    };
    setActiveConversation(pending);
    setPanelView("chat");
    setPrompt("");
    setBusy("agent");
    setError("");
    setNotice("");
    activeRequest.current = requestId;
    activeMessage.current = pendingMessage.id;
    cancelledRequests.current.delete(requestId);
    try {
      await persist(pending);
      const history = conversation.messages
        .filter((message) => (message.status === undefined || message.status === "complete") && Boolean(message.content.trim()))
        .slice(-10)
        .map((message) => ({ role: message.role, content: message.content }));
      const response = typeof chrome.runtime.connect === "function"
        ? await new Promise<BookmarkAgentResponse>((resolve, reject) => {
            const port = chrome.runtime.connect({ name: "agent-stream" });
            activeAgentPort.current = port;
            port.onMessage.addListener((raw: unknown) => {
              const event = raw as { type?: string; text?: string; response?: BookmarkAgentResponse; error?: string };
              if (event.type === "delta" && typeof event.text === "string") {
                setActiveConversation((current) => current ? {
                  ...current,
                  messages: current.messages.map((message) =>
                    message.id === pendingMessage.id
                      ? { ...message, content: `${message.content}${event.text}` }
                      : message
                  )
                } : current);
              } else if (event.type === "done" && event.response) {
                resolve(event.response);
                port.disconnect();
              } else if (event.type === "error") {
                reject(new Error(event.error || "AI 暂时无法回答"));
                port.disconnect();
              }
            });
            port.postMessage({ type: "start", query, requestId, history });
          })
        : await sendExtensionRequest({ type: "ASK_BOOKMARK_AGENT", query, requestId, history });
      if (cancelledRequests.current.has(requestId)) return;
      const completed: AgentConversation = {
        ...pending,
        updatedAt: new Date().toISOString(),
        messages: pending.messages.map((message) => message.id === pendingMessage.id ? {
          ...message,
          content: response.answer,
          thinking: response.thinking,
          providerName: undefined,
          sources: response.sources,
          actions: response.actions,
          status: "complete",
          progress: undefined,
        } : message),
      };
      setActiveConversation(completed);
      await persist(completed);
    } catch (caught) {
      if (cancelledRequests.current.has(requestId)) return;
      const reason = caught instanceof Error ? caught.message : "AI 暂时无法回答";
      const failed: AgentConversation = {
        ...pending,
        updatedAt: new Date().toISOString(),
        messages: pending.messages.map((message) => message.id === pendingMessage.id
          ? { ...message, content: `这次没有完成：${reason}`, status: "failed" }
          : message),
      };
      setActiveConversation(failed);
      setError("");
      await persist(failed).catch(() => undefined);
    } finally {
      if (activeRequest.current === requestId) {
        activeRequest.current = "";
        activeMessage.current = "";
        setBusy("");
      }
      activeAgentPort.current = null;
      cancelledRequests.current.delete(requestId);
    }
  }

  async function cancelRun() {
    if (busy === "agent-actions" && activeExecution.current) {
      const requestId = activeExecution.current;
      await sendExtensionRequest({
        type: "CANCEL_AGENT_PLAN_EXECUTION",
        requestId
      }).catch(() => undefined);
      setNotice("正在停止；已完成的操作会保留，可整批撤销。");
      return;
    }
    const requestId = activeRequest.current;
    const messageId = activeMessage.current;
    if (!requestId || !messageId || busy !== "agent") return;
    cancelledRequests.current.add(requestId);
    activeAgentPort.current?.disconnect();
    activeAgentPort.current = null;
    activeMessage.current = "";
    setBusy("");
    setError("");
    const updated = activeConversation ? {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      messages: activeConversation.messages.map((message) => message.id === messageId
        ? { ...message, content: "已停止本次回答。", status: "cancelled" as const, progress: undefined }
        : message),
    } : null;
    if (updated) {
      setActiveConversation(updated);
      await persist(updated).catch(() => undefined);
    }
    await sendExtensionRequest({ type: "CANCEL_BOOKMARK_AGENT", requestId }).catch(() => undefined);
  }

  async function confirmActions(messageId: string) {
    if (!activeConversation || busy) return;
    const source = activeConversation.messages.find((message) => message.id === messageId);
    const pendingActions = (source?.actions || []).filter(
      (action) => action.status === "pending" && action.selected !== false
    );
    if (!source || !pendingActions.length) return;
    const mark = (
      actions: BookmarkAgentActionProposal[],
      status: BookmarkAgentActionProposal["status"],
      resultMessage = "",
    ) => actions.map((action) => action.status === "pending" || action.status === "executing"
      ? { ...action, status, ...(resultMessage ? { resultMessage } : {}) }
      : action);
    const executing: AgentConversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      messages: activeConversation.messages.map((message) => message.id === messageId
        ? { ...message, actions: mark(message.actions || [], "executing") }
        : message),
    };
    setActiveConversation(executing);
    setBusy("agent-actions");
    setError("");
    try {
      const executionRequestId = crypto.randomUUID();
      activeExecution.current = executionRequestId;
      const response = await sendExtensionRequest({
        type: "EXECUTE_BOOKMARK_AGENT_ACTIONS",
        actions: pendingActions,
        requestId: executionRequestId
      });
      const resultById = new Map(response.results.map((result) => [result.actionId, result]));
      const completedActions = (source.actions || []).map((action) => {
        const result = resultById.get(action.id);
        return result ? { ...action, status: result.success ? "completed" : "failed", resultMessage: result.message } satisfies BookmarkAgentActionProposal : action;
      });
      const succeeded = response.results.filter((result) => result.success).length;
      const failedCount = response.results.length - succeeded;
      const timestamp = new Date().toISOString();
      const resultMessage: AgentChatMessage = {
        id: crypto.randomUUID(), role: "assistant", createdAt: timestamp,
        content: succeeded
          ? `已完成 ${succeeded} 项操作，并重新读取 Chrome 书签确认。${failedCount ? `另有 ${failedCount} 项未完成，请查看上方原因。` : ""}`
          : `没有完成任何操作。${response.results[0]?.message ? `原因：${response.results[0].message}` : ""}`,
        ...(response.batchId ? { undoBatchId: response.batchId } : {}),
        status: failedCount && !succeeded ? "failed" : "complete",
      };
      const completed: AgentConversation = {
        ...executing,
        updatedAt: timestamp,
        messages: [
          ...executing.messages.map((message) => message.id === messageId ? { ...message, actions: completedActions } : message),
          resultMessage,
        ],
      };
      setActiveConversation(completed);
      await persist(completed);
      await refresh();
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "Chrome 操作失败";
      const timestamp = new Date().toISOString();
      const failedConversation: AgentConversation = {
        ...executing,
        updatedAt: timestamp,
        messages: [
          ...executing.messages.map((message) => message.id === messageId
            ? { ...message, actions: mark(message.actions || [], "failed", reason) }
            : message),
          { id: crypto.randomUUID(), role: "assistant", content: `没有完成任何操作。原因：${reason}`, createdAt: timestamp, status: "failed" },
        ],
      };
      setActiveConversation(failedConversation);
      setError("");
      await persist(failedConversation).catch(() => undefined);
    } finally {
      activeExecution.current = "";
      setBusy("");
    }
  }

  function togglePendingAction(messageId: string, actionId: string) {
    if (!activeConversation || busy) return;
    const updated = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      messages: activeConversation.messages.map((message) => message.id === messageId ? {
        ...message,
        actions: (message.actions || []).map((action) =>
          action.id === actionId && action.status === "pending"
            ? { ...action, selected: action.selected === false }
            : action
        )
      } : message)
    };
    setActiveConversation(updated);
    void persist(updated);
  }

  function updatePendingActions(messageId: string, actionId?: string) {
    if (!activeConversation || busy) return;
    const updated: AgentConversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      messages: activeConversation.messages.map((message) => message.id === messageId ? {
        ...message,
        actions: (message.actions || []).map((action) => action.status === "pending" && (!actionId || action.id === actionId)
          ? { ...action, status: "cancelled" as const, resultMessage: actionId ? "已从这批操作中移除。" : "已取消，没有修改 Chrome。" }
          : action),
      } : message),
    };
    setActiveConversation(updated);
    void persist(updated);
  }

  async function undoBatch(messageId: string, batchId: string) {
    if (!activeConversation || busy || !batchId) return;
    setBusy("agent-actions");
    setError("");
    try {
      const result = await sendExtensionRequest({ type: "UNDO_BOOKMARK_BATCH", batchId });
      const updated: AgentConversation = {
        ...activeConversation,
        updatedAt: new Date().toISOString(),
        messages: activeConversation.messages.map((message) => message.id === messageId ? {
          ...message,
          content: `${message.content}\n${result.failed ? `已恢复 ${result.restored} 项，${result.failed} 项需要手动处理。` : `已撤销 ${result.restored} 项更改。`}`,
          undoBatchId: undefined,
        } : message),
      };
      setActiveConversation(updated);
      await persist(updated);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤销失败");
    } finally {
      setBusy("");
    }
  }

  function submit(input: string) {
    const query = input.trim();
    if (!query || busy) return;
    if (!aiConfigured) {
      setPanelView("settings");
      return;
    }
    const timestamp = new Date().toISOString();
    const pendingEdit = editingBase.current;
    const edited = pendingEdit && pendingEdit.conversationId === activeConversation?.id
      ? pendingEdit.conversation
      : null;
    editingBase.current = null;
    const conversation = edited || (panelView === "chat" && activeConversation ? activeConversation : {
      id: crypto.randomUUID(), title: query.slice(0, 36), createdAt: timestamp, updatedAt: timestamp, messages: [],
    });
    void runTurn(conversation, query);
  }

  function conversationBeforeMessage(messageId: string, role: "user" | "assistant") {
    if (!activeConversation || busy) return null;
    const index = activeConversation.messages.findIndex((message) => message.id === messageId && message.role === role);
    if (index < 0) return null;
    const userIndex = role === "user"
      ? index
      : activeConversation.messages.slice(0, index).findLastIndex((message) => message.role === "user");
    if (userIndex < 0) return null;
    const query = activeConversation.messages[userIndex]?.content.trim();
    if (!query) return null;
    return {
      query,
      conversation: {
        ...activeConversation,
        updatedAt: new Date().toISOString(),
        messages: activeConversation.messages.slice(0, userIndex),
      } satisfies AgentConversation,
    };
  }

  function regenerate(messageId: string) {
    const target = conversationBeforeMessage(messageId, "assistant");
    if (target) void runTurn(target.conversation, target.query);
  }

  function editQuestion(messageId: string) {
    const target = conversationBeforeMessage(messageId, "user");
    if (!target || !activeConversation) return;
    editingBase.current = {
      conversationId: activeConversation.id,
      conversation: target.conversation,
    };
    setPrompt(target.query);
    setNotice("问题已放回输入框；修改后发送会从这里重新生成回答。");
  }

  async function copyAnswer(messageId: string) {
    const message = activeConversation?.messages.find((item) => item.id === messageId && item.role === "assistant");
    if (!message?.content.trim()) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setNotice("回答已复制");
    } catch {
      setError("复制失败，请手动选择回答文本。");
    }
  }

  useEffect(() => {
    const eventSource = typeof chrome !== "undefined" ? chrome.runtime?.onMessage : undefined;
    const handleProgress = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const event = message as Partial<BookmarkAgentProgress> & { type?: string; steps?: unknown };
      if (
        event.type === "BOOKMARK_AGENT_EXECUTION_PROGRESS" &&
        (message as { requestId?: string }).requestId === activeExecution.current
      ) {
        const execution = message as { done?: number; total?: number };
        if (typeof execution.done === "number" && typeof execution.total === "number") {
          setNotice(`正在执行 ${execution.done}/${execution.total}`);
        }
        return;
      }
      if (event.type === "BOOKMARK_AGENT_THINKING" && event.requestId === activeRequest.current && activeMessage.current && Array.isArray(event.steps)) {
        const thinking = event.steps.filter((step): step is string => typeof step === "string").map((step) => step.trim().slice(0, 140)).filter(Boolean).slice(0, 8);
        setActiveConversation((current) => current ? {
          ...current,
          messages: current.messages.map((item) => item.id === activeMessage.current ? { ...item, thinking } : item),
        } : current);
        return;
      }
      if (event.type !== "BOOKMARK_AGENT_PROGRESS" || event.requestId !== activeRequest.current || !activeMessage.current || !event.stage || !Array.isArray(event.stages) || !Array.isArray(event.completedStages) || typeof event.completed !== "number" || typeof event.total !== "number" || typeof event.label !== "string") return;
      const valid = (stage: unknown): stage is BookmarkAgentProgressStage => AGENT_PROGRESS_STEPS.some((item) => item.stage === stage);
      const stages = event.stages.filter(valid);
      if (!stages.includes(event.stage)) return;
      const progress: BookmarkAgentProgress = {
        requestId: event.requestId,
        stage: event.stage,
        stages,
        completedStages: event.completedStages.filter(valid),
        completed: event.completed,
        total: event.total,
        label: event.label,
      };
      setActiveConversation((current) => current ? {
        ...current,
        messages: current.messages.map((item) => item.id === activeMessage.current ? { ...item, progress } : item),
      } : current);
    };
    eventSource?.addListener(handleProgress);
    return () => eventSource?.removeListener(handleProgress);
  }, []);

  return {
    prompt, setPrompt, conversations, activeConversation, setActiveConversation,
    loadConversations, deleteConversation,
    cancelRun, confirmActions, dropAction: (messageId: string, actionId: string) => updatePendingActions(messageId, actionId),
    toggleAction: togglePendingAction,
    cancelActions: (messageId: string) => updatePendingActions(messageId), undoBatch, submit,
    regenerate, editQuestion, copyAnswer,
  };
}

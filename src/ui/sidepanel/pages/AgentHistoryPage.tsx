import { useState } from "react";
import "../../sidepanel-lazy.css";
import { Button } from "@/ui/components/ui/button";
import { FluidInput } from "@/ui/components/ui/input";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  HistoryIcon,
  TrashIcon
} from "../../components/Icons";
import type { AgentConversation } from "../../../lib/types";
import { conversationDate } from "../utils";
interface AgentHistoryPageProps {
  conversations: AgentConversation[];
  onBack: () => void;
  onOpen: (conversation: AgentConversation) => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (conversation: AgentConversation, title: string) => Promise<void>;
}

function AgentHistoryPage({
  conversations,
  onBack,
  onOpen,
  onDelete,
  onRename,
}: AgentHistoryPageProps) {
  const [editingId, setEditingId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [busyId, setBusyId] = useState("");

  async function saveTitle(conversation: AgentConversation) {
    const title = editingTitle.trim();
    if (!title || busyId) return;
    setBusyId(conversation.id);
    try {
      await onRename(conversation, title);
      setEditingId("");
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="native-panel agent-history-panel">
      <header className="agent-page-header">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="icon-button"
          aria-label="返回收藏列表"
          title="返回"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <div>
          <h1>历史会话</h1>
        </div>
      </header>
      <section className="agent-history-list">
        {conversations.length ? (
          conversations.map((conversation) => {
            const preview = [...conversation.messages]
              .reverse()
              .find((message) => message.role === "assistant")?.content;
            return (
              <article key={conversation.id}>
                {editingId === conversation.id ? (
                  <form
                    className="agent-history-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveTitle(conversation);
                    }}
                  >
                    <FluidInput
                      autoFocus
                      value={editingTitle}
                      maxLength={80}
                      aria-label="会话名称"
                      onChange={(event) => setEditingTitle(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="agent-history-action"
                      disabled={Boolean(busyId)}
                      onClick={() => setEditingId("")}
                    >
                      取消
                    </Button>
                    <Button
                      type="submit"
                      variant="ghost"
                      className="agent-history-action"
                      disabled={!editingTitle.trim() || Boolean(busyId)}
                    >
                      保存
                    </Button>
                  </form>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      type="button"
                      className="agent-history-open"
                      onClick={() => onOpen(conversation)}
                    >
                      <span>
                        <strong>{conversation.title}</strong>
                        <time>{conversationDate(conversation.updatedAt)}</time>
                      </span>
                      <small>{preview || "尚未生成回答"}</small>
                      <ChevronRightIcon />
                    </Button>
                    <div className="agent-history-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        className="agent-history-action"
                        onClick={() => {
                          setEditingId(conversation.id);
                          setEditingTitle(conversation.title);
                          setConfirmDeleteId("");
                        }}
                      >
                        改名
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="agent-history-action"
                        data-danger={confirmDeleteId === conversation.id}
                        disabled={busyId === conversation.id}
                        onClick={() => {
                          if (confirmDeleteId !== conversation.id) {
                            setConfirmDeleteId(conversation.id);
                            return;
                          }
                          setBusyId(conversation.id);
                          void onDelete(conversation.id).finally(() => {
                            setBusyId("");
                            setConfirmDeleteId("");
                          });
                        }}
                      >
                        {confirmDeleteId === conversation.id
                          ? "确认删除"
                          : "删除"}
                      </Button>
                    </div>
                  </>
                )}
              </article>
            );
          })
        ) : (
          <div className="agent-history-empty">
            <HistoryIcon />
            <strong>还没有历史会话</strong>
            <p>在收藏列表底部提问后，会话会自动保存在这里。</p>
          </div>
        )}
      </section>
    </main>
  );
}


export default AgentHistoryPage;

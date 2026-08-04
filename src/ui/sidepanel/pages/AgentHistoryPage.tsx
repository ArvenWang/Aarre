import { useState } from "react";
import "../../sidepanel-lazy.css";
import { Button } from "@/ui/components/ui/button";
import {
  ArrowLeftIcon,
  HistoryIcon,
} from "../../components/Icons";
import type { AgentConversation } from "../../../lib/types";
import { conversationDate } from "../utils";
interface AgentHistoryPageProps {
  conversations: AgentConversation[];
  onBack: () => void;
  onOpen: (conversation: AgentConversation) => void;
  onDelete: (id: string) => Promise<void>;
}

function AgentHistoryPage({
  conversations,
  onBack,
  onOpen,
  onDelete,
}: AgentHistoryPageProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [busyId, setBusyId] = useState("");

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
              <article className="bookmark-row" key={conversation.id}>
                <Button
                  variant="ghost"
                  size="unstyled"
                  type="button"
                  className="agent-history-open"
                  onClick={() => onOpen(conversation)}
                >
                  <strong>{conversation.title}</strong>
                  <small>{preview || "尚未生成回答"}</small>
                  <time>{conversationDate(conversation.updatedAt)}</time>
                </Button>
                <div className="agent-history-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
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
                    {confirmDeleteId === conversation.id ? "确认删除" : "删除"}
                  </Button>
                </div>
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

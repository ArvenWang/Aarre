import React, { Fragment, useEffect, useRef } from "react";
import "../../sidepanel-lazy.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/ui/components/ui/button";
import { Checkbox } from "@/ui/components/ui/checkbox";
import { registrableHost } from "../../../lib/cover-registry";
import { canonicalizeUrl } from "../../../lib/url";
import { currentSiteBrandImageUrl } from "../../../lib/thumbnail";
import type {
  AgentConversation,
  BookmarkAgentActionProposal,
  BookmarkAgentSource,
  ResourceRecord,
  SiteBrandRecord
} from "../../../lib/types";
import { ArrowLeftIcon, CloseIcon } from "../../components/Icons";
import { SiteThumbnail } from "../../components/SiteThumbnail";
import { AgentComposer } from "../components/AgentComposer";
import { AgentThinkingSteps } from "../components/AgentThinkingSteps";
import { hostFromUrl } from "../utils";

function AgentMarkdown({
  content,
  resourceByUrl,
  siteBrandByHost,
}: {
  content: string;
  resourceByUrl: Map<string, ResourceRecord>;
  siteBrandByHost: Map<string, SiteBrandRecord>;
}) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
            const resource = href ? resourceForUrl(resourceByUrl, href) : undefined;
            if (!resource) {
              return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
            }
            return (
              <a className="agent-inline-source" href={resource.url} target="_blank" rel="noreferrer noopener" title={resource.title}>
                <SiteThumbnail
                  url={resource.url}
                  imageUrl={resource.thumbnailDataUrl}
                  brandImageUrl={currentSiteBrandImageUrl(siteBrandForUrl(siteBrandByHost, resource.url))}
                  categoryCoverId={resource.categoryCoverId}
                  forceSiteBrand
                  label={resource.siteName || resource.title}
                  className="agent-inline-source-thumbnail"
                />
                <span>{children}</span>
              </a>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function sourceIsCited(content: string, source: BookmarkAgentSource): boolean {
  if (content.includes(source.url)) return true;
  const links = [...content.matchAll(/\]\((https?:\/\/[^\s)]+)(?:\s+[^)]*)?\)/g)];
  try {
    const canonical = canonicalizeUrl(source.url);
    return links.some((match) => {
      try { return canonicalizeUrl(match[1]) === canonical; } catch { return false; }
    });
  } catch {
    return false;
  }
}

function uncitedSources(
  content: string,
  sources: BookmarkAgentSource[] | undefined
): BookmarkAgentSource[] {
  return (sources || []).filter((source) => !sourceIsCited(content, source));
}

function resourceForUrl(resourceByUrl: Map<string, ResourceRecord>, url: string) {
  const direct = resourceByUrl.get(url);
  if (direct) return direct;
  try { return resourceByUrl.get(canonicalizeUrl(url)); } catch { return undefined; }
}

function siteBrandForUrl(siteBrandByHost: Map<string, SiteBrandRecord>, input: string) {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    return siteBrandByHost.get(host) || siteBrandByHost.get(registrableHost(host));
  } catch { return undefined; }
}
function conversationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Proposals answering one semantic instruction share a groupLabel, so the
 *  confirm card can show the criterion once above its hit list. */
function groupAgentActions(
  actions: BookmarkAgentActionProposal[],
): Array<{ label: string; actions: BookmarkAgentActionProposal[] }> {
  const groups: Array<{
    label: string;
    actions: BookmarkAgentActionProposal[];
  }> = [];
  for (const action of actions) {
    const label = action.groupLabel || "";
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.actions.push(action);
    } else {
      groups.push({ label, actions: [action] });
    }
  }
  return groups;
}

function agentActionCardTitle(actions: BookmarkAgentActionProposal[]): string {
  if (!actions.some((action) => action.status === "pending")) {
    return "操作结果";
  }
  return actions.every((action) => action.type === "update_metadata")
    ? "确认后才会更新 Aarre 信息"
    : "确认后才会修改 Chrome";
}

interface AgentChatPageProps {
  conversation: AgentConversation;
  resourceByUrl: Map<string, ResourceRecord>;
  siteBrandByHost: Map<string, SiteBrandRecord>;
  prompt: string;
  busy: boolean;
  configured: boolean;
  error: string;
  onPromptChange: (value: string) => void;
  onConfigure: () => void;
  onCancel?: () => void;
  onBack: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onOpenSource: (url: string) => void;
  onRegenerate: (messageId: string) => void;
  onEditQuestion: (messageId: string) => void;
  onCopyAnswer: (messageId: string) => void;
  onConfirmActions: (messageId: string) => void;
  onCancelActions: (messageId: string) => void;
  onDropAction: (messageId: string, actionId: string) => void;
  onToggleAction: (messageId: string, actionId: string) => void;
  onUndoBatch: (messageId: string, batchId: string) => void;
}

function AgentChatPage({
  conversation,
  resourceByUrl,
  siteBrandByHost,
  prompt,
  busy,
  configured,
  error,
  onPromptChange,
  onConfigure,
  onCancel,
  onBack,
  onSubmit,
  onOpenSource,
  onRegenerate,
  onEditQuestion,
  onCopyAnswer,
  onConfirmActions,
  onCancelActions,
  onDropAction,
  onToggleAction,
  onUndoBatch,
}: AgentChatPageProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      block: "end",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [conversation.messages.length]);

  return (
    <main className="native-panel agent-chat-panel">
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
          <h1>收藏对话</h1>
        </div>
      </header>
      <section className="agent-thread" aria-live="polite">
        {conversation.messages.map((message) => (
          <article
            key={message.id}
            className="agent-message"
            data-role={message.role}
            data-status={message.status || "complete"}
          >
            <div className="agent-message-copy">
              {message.status === "sending" ? (
                <AgentThinkingSteps
                  progress={message.progress}
                  thinking={message.thinking}
                />
              ) : (
                <Fragment>
                  {message.thinking?.length ? (
                    <details className="agent-thinking-recap">
                      <summary>思考过程</summary>
                      <ol>
                        {message.thinking.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                  {message.role === "assistant" ? (
                    <AgentMarkdown
                      content={message.content}
                      resourceByUrl={resourceByUrl}
                      siteBrandByHost={siteBrandByHost}
                    />
                  ) : (
                    <p>{message.content}</p>
                  )}
                </Fragment>
              )}
              {message.providerName ? (
                <small>{message.providerName}</small>
              ) : null}
            </div>
            {uncitedSources(message.content, message.sources).length ? (
              <div className="agent-message-sources">
                <span>其他相关收藏</span>
                {uncitedSources(message.content, message.sources).map((source) => (
                  <Button
                    type="button"
                    variant="ghost"
                    size="unstyled"
 className="agent-source-button"
                    key={source.resourceKey}
                    onClick={() => onOpenSource(source.url)}
                  >
                    <SiteThumbnail
                      url={source.url}
                      imageUrl={
                        resourceForUrl(resourceByUrl, source.url)
                          ?.thumbnailDataUrl
                      }
                      brandImageUrl={currentSiteBrandImageUrl(
                        siteBrandForUrl(siteBrandByHost, source.url),
                      )}
                      categoryCoverId={
                        resourceForUrl(resourceByUrl, source.url)
                          ?.categoryCoverId
                      }
                      forceSiteBrand
                      label={source.siteName || source.title}
                      className="agent-source-thumbnail"
                    />
                    <span>
                      <strong>{source.title}</strong>
                      <small>{hostFromUrl(source.url)}</small>
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
            {message.actions?.length ? (
              <section
                className="agent-action-card"
                aria-label="待确认的书签操作"
              >
                <header>
                  <strong>{agentActionCardTitle(message.actions)}</strong>
                  <small>
                    {message.actions.some(
                      (action) => action.status === "pending",
                    )
                      ? `命中 ${
                          message.actions.filter(
                            (action) => action.status === "pending",
                          ).length
                        } 条`
                      : `${message.actions.length} 项`}
                  </small>
                </header>
                {groupAgentActions(message.actions).map((group) => (
                  <details
                    className="agent-action-group"
                    key={group.label || "default"}
                  >
                    <summary>
                      <span>{group.label || "其他操作"}</span>
                      <strong>{group.actions.length} 项</strong>
                      {group.actions.some((action) => action.destructive) ? (
                        <span aria-label="包含删除操作">⚠</span>
                      ) : null}
                    </summary>
                    <ul>
                      {group.actions.map((action) => (
                        <li
                          key={action.id}
                          data-status={action.status}
                          data-destructive={action.destructive}
                        >
                          {action.destructive && action.status === "pending" ? (
                            <Checkbox
                              checked={action.selected !== false}
                              aria-label={`选择执行：${action.label}`}
                              disabled={busy}
                              onCheckedChange={() => onToggleAction(message.id, action.id)}
                            />
                          ) : <span aria-hidden="true" />}
                          <div>
                            <strong>{action.label}</strong>
                            <small>
                              {action.resultMessage || action.description}
                            </small>
                          </div>
                          {action.status === "pending" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
 className="agent-action-drop"
                              aria-label={`不执行：${action.label}`}
                              disabled={busy}
                              onClick={() =>
                                onDropAction(message.id, action.id)
                              }
                            >
                              <CloseIcon />
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
                {message.actions.some(
                  (action) => action.status === "pending",
                ) ? (
                  <footer>
                    <Button
                      variant="ghost" size="sm"
                      type="button"

                      disabled={busy}
                      onClick={() => onCancelActions(message.id)}
                    >
                      取消
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      className={
                        message.actions.some((action) => action.destructive)
                          ? "agent-action-confirm agent-action-confirm-danger"
                          : "agent-action-confirm"
                      }
                      disabled={
                        busy ||
                        !message.actions.some(
                          (action) => action.status === "pending" && action.selected !== false
                        )
                      }
                      onClick={() => onConfirmActions(message.id)}
                    >
                      {busy
                        ? "正在执行…"
                        : `确认执行 ${
                            message.actions.filter(
                              (action) => action.status === "pending" && action.selected !== false,
                            ).length
                          } 项`}
                    </Button>
                  </footer>
                ) : null}
              </section>
            ) : null}
            {message.undoBatchId ? (
              <Button
                variant="ghost"
                type="button"
 className="agent-undo-button"
                disabled={busy}
                onClick={() =>
                  onUndoBatch(message.id, message.undoBatchId || "")
                }
              >
                {busy ? "正在恢复…" : "撤销这批操作"}
              </Button>
            ) : null}
            {message.status !== "sending" ? (
              <div className="agent-message-controls" aria-label="消息操作">
                {message.role === "user" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => onEditQuestion(message.id)}
                  >
                    编辑并重发
                  </Button>
                ) : (
                  <Fragment>
                    {message.content.trim() ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onCopyAnswer(message.id)}
                      >
                        复制
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRegenerate(message.id)}
                    >
                      {message.status === "failed" ? "重试" : "重新生成"}
                    </Button>
                  </Fragment>
                )}
              </div>
            ) : null}
          </article>
        ))}
        {error ? (
          <div className="agent-thread-error" role="alert">
            {error}
          </div>
        ) : null}
        <div ref={endRef} />
      </section>
      <AgentComposer
        value={prompt}
        busy={busy}
        configured={configured}
        placeholder="继续询问…"
        onChange={onPromptChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onConfigure={onConfigure}
      />
    </main>
  );
}

export default AgentChatPage;

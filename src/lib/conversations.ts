import type { AgentChatMessage, AgentConversation } from "./types";

const CONVERSATIONS_KEY = "aarre:agent-conversations";
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 60;

const VALID_MESSAGE_STATUSES = new Set([
  "sending",
  "complete",
  "failed",
  "cancelled"
]);

function isMessage(value: unknown): value is AgentChatMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AgentChatMessage>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string" &&
    typeof candidate.createdAt === "string" &&
    (candidate.status === undefined ||
      VALID_MESSAGE_STATUSES.has(candidate.status))
  );
}

function isConversation(value: unknown): value is AgentConversation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AgentConversation>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isMessage)
  );
}

export async function getAgentConversations(): Promise<
  AgentConversation[]
> {
  const stored = (await chrome.storage.local.get(CONVERSATIONS_KEY))[
    CONVERSATIONS_KEY
  ];
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(isConversation)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_CONVERSATIONS);
}

export async function saveAgentConversation(
  conversation: AgentConversation
): Promise<AgentConversation> {
  const normalized: AgentConversation = {
    ...conversation,
    id: conversation.id.slice(0, 160),
    title: conversation.title.trim().slice(0, 80) || "新会话",
    messages: conversation.messages
      .filter(isMessage)
      .slice(-MAX_MESSAGES_PER_CONVERSATION)
      .map((message) => ({
        ...message,
        id: message.id.slice(0, 160),
        content: message.content.slice(0, 12_000),
        providerName: message.providerName?.slice(0, 240),
        sources: message.sources?.slice(0, 20),
        actions: message.actions?.slice(0, 40)
      }))
  };
  const current = await getAgentConversations();
  await chrome.storage.local.set({
    [CONVERSATIONS_KEY]: [
      normalized,
      ...current.filter((item) => item.id !== normalized.id)
    ].slice(0, MAX_CONVERSATIONS)
  });
  return normalized;
}

export async function deleteAgentConversation(
  id: string
): Promise<void> {
  const current = await getAgentConversations();
  await chrome.storage.local.set({
    [CONVERSATIONS_KEY]: current.filter((item) => item.id !== id)
  });
}

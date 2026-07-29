import type { AgentConversation } from "./types";

const CONVERSATIONS_KEY = "aarre:agent-conversations";
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 60;

function isConversation(value: unknown): value is AgentConversation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AgentConversation>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.messages)
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
    title: conversation.title.trim().slice(0, 80) || "新会话",
    messages: conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION)
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

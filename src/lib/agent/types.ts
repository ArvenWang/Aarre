import type { BookmarkAgentActionProposal } from "../types";

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface AgentProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: AgentToolCall[];
}

export interface AgentProviderResponse {
  text: string;
  toolCalls: AgentToolCall[];
  assistantMessage: AgentProviderMessage;
  providerName?: string;
}

export interface AgentPlan {
  actions: BookmarkAgentActionProposal[];
}

export interface AgentRunResult {
  answer: string;
  plan: AgentPlan;
  rounds: number;
  providerName?: string;
  stoppedByLimit: boolean;
}

import type { AgentConversation, AiProviderId, BookmarkAgentActionProposal } from "../../lib/types";

export const PREVIEW_UNHANDLED = Symbol("preview-unhandled");
export interface PreviewRequest {
  type?: string; apiKey?: string; query?: string; requestId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  force?: boolean; id?: string; batchId?: string; tabId?: number;
  canonicalUrl?: string; conversation?: AgentConversation;
  actions?: BookmarkAgentActionProposal[];
  target?: { kind: "bookmark" | "folder"; id: string }; protected?: boolean;
  payload?: { id?: string; parentId?: string; index?: number; folderId?: string;
    title?: string; url?: string; bookmarkId?: string; resourceKey?: string;
    tags?: string[]; tagsChanged?: boolean; userNote?: string;
    provider?: AiProviderId; model?: string; apiKey?: string };
}

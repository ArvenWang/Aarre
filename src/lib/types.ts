export type AiStatus =
  | "not_requested"
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "unavailable";

export type SyncStatus = "local" | "pending" | "synced" | "failed";

export interface PageCapture {
  url: string;
  canonicalUrl: string;
  title: string;
  description: string;
  content: string;
  excerpt: string;
  selectedText: string;
  author: string;
  siteName: string;
  language: string;
  imageUrl: string;
  faviconUrl: string;
}

export interface PendingSaveDraft {
  kind: "page" | "link";
  tabId: number;
  url: string;
  title: string;
  faviconUrl: string;
  selectedText: string;
  createdAt: string;
}

export interface NativeFolderOption {
  id: string;
  name: string;
  path: string[];
  depth: number;
}

export interface NativeBookmarkNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  dateAdded?: number;
  dateLastUsed?: number;
  folderType?: string;
  syncing?: boolean;
  unmodifiable?: boolean;
  children?: NativeBookmarkNode[];
}

export interface BookmarkBarSnapshot {
  root: NativeBookmarkNode;
  roots: NativeBookmarkNode[];
  primaryRootId: string;
  bookmarkCount: number;
  folderCount: number;
  syncing: boolean | null;
}

export type NavigationSuggestionKind =
  | "bookmark"
  | "history"
  | "tab";

export interface NavigationSuggestion {
  id: string;
  kind: NavigationSuggestionKind;
  title: string;
  url: string;
  subtitle: string;
  tabId?: number;
  windowId?: number;
}

export interface NavigationInput {
  text: string;
  url?: string;
  tabId?: number;
  windowId?: number;
  disposition?: "current" | "new";
}

export interface ResourceRecord {
  resourceKey: string;
  canonicalUrl: string;
  url: string;
  title: string;
  userNote: string;
  summary: string;
  tags: string[];
  topics: string[];
  contentExcerpt: string;
  contentHash: string;
  selectedText: string;
  author: string;
  siteName: string;
  language: string;
  imageUrl: string;
  faviconUrl: string;
  nativeBookmarkIds: string[];
  nativeFolderPath: string[];
  aiStatus: AiStatus;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
}

export interface OutboxItem {
  revision: string;
  resource: ResourceRecord;
  content: string;
  attempts: number;
  queuedAt: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
}

export interface AuthState {
  configured: boolean;
  signedIn: boolean;
  userEmail?: string;
  userName?: string;
  userAvatarUrl?: string;
  chromeProfileEmail?: string;
  accountMatches: boolean | null;
  redirectUrl?: string;
}

export interface ActiveTabSummary {
  id?: number;
  url: string;
  title: string;
  faviconUrl: string;
  supported: boolean;
}

export interface AppState {
  auth: AuthState;
  activeTab: ActiveTabSummary | null;
  localResourceCount: number;
  pendingSyncCount: number;
}

export interface SaveBookmarkInput {
  capture: PageCapture;
  title: string;
  userNote: string;
  folderId: string;
  requestAi: boolean;
}

export interface SaveBookmarkResult {
  resource: ResourceRecord;
  nativeBookmarkCreated: boolean;
  cloudSyncAttempted: boolean;
}

export interface ImportResult {
  scanned: number;
  imported: number;
  alreadyKnown: number;
}

export interface RestoreResult {
  restored: number;
  alreadyPresent: number;
}

export interface SearchResult {
  resource: ResourceRecord;
  score?: number;
  matchReason?: string;
}

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

export interface BookmarkSaveMatch {
  id: string;
  parentId: string;
  title: string;
  url: string;
  folderPath: string[];
  unmodifiable: boolean;
  matchKind: "exact" | "canonical";
}

export interface BookmarkSaveState {
  status: "none" | "exact" | "canonical" | "multiple" | "readonly";
  matches: BookmarkSaveMatch[];
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
  tagsSource?: "ai" | "user";
  topics: string[];
  aliases?: string[];
  contentExcerpt: string;
  contentHash: string;
  selectedText: string;
  author: string;
  siteName: string;
  language: string;
  imageUrl: string;
  /** 代表图的本地 WebP 缓存，不上传云端，避免列表受站点防盗链影响。 */
  thumbnailDataUrl?: string;
  coverSource?: string;
  coverUpdatedAt?: string;
  categoryCoverId?: string;
  snapshotAt?: string;
  enhancementBlockReason?: "privacy";
  enhancementBlockMessage?: string;
  linkHealth?: LinkHealthRecord;
  faviconUrl: string;
  nativeBookmarkIds: string[];
  nativeFolderPath: string[];
  aiStatus: AiStatus;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
}

export type SiteIconSource =
  | "registry"
  | "apple-touch-icon"
  | "conventional-apple-touch-icon"
  | "conventional-favicon-ico"
  | "manifest"
  | "svg-icon"
  | "large-icon"
  | "msapplication-tile";

export interface SiteIconCandidate {
  url: string;
  source: SiteIconSource;
  declaredSize?: number;
  vector?: boolean;
}

export interface SiteBrandRecord {
  host: string;
  /** 兼容 0.3.4 及更早版本；新记录与浅色主题值相同。 */
  iconDataUrl?: string;
  iconDataUrlLight?: string;
  iconDataUrlDark?: string;
  iconSource?: SiteIconSource;
  iconRejectReason?: string;
  nativeWidth?: number;
  nativeHeight?: number;
  skipPageImage?: boolean;
  pageImageSamples?: Record<string, string[]>;
  updatedAt: string;
}

export interface PageSnapshot {
  canonicalUrl: string;
  imageDataUrl: string;
  capturedAt: string;
  width: number;
  height: number;
}

export type LinkHealthStatus =
  | "healthy"
  | "login_required"
  | "temporary"
  | "dead"
  | "soft_404";

export interface LinkHealthRecord {
  status: LinkHealthStatus;
  checkedAt: string;
  consecutiveFailures: number;
  httpStatus?: number;
  finalUrl?: string;
  reason?: string;
}

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimated: boolean;
}

export interface AiUsageStats {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedTokens: number;
  estimatedCostCny: number;
  scanCount: number;
  priceUpdatedAt: string;
  updatedAt: string;
}

export type UserTier = "byok" | "free" | "pro";

export interface AiEntitlement {
  tier: UserTier;
  monthlyTokenQuota: number | null;
  usedTokensThisMonth: number;
  period: string;
  source: "local";
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
  aiReadyResourceCount: number;
  pendingSyncCount: number;
  libraryScan: LibraryScanStatus;
}

export type AiProviderId = "gemini" | "openai" | "deepseek";

export interface AiProviderPreset {
  id: AiProviderId;
  name: string;
  defaultModel: string;
  description: string;
  apiKeyPlaceholder: string;
}

export interface AiSettingsStatus {
  provider: AiProviderId;
  providerName: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeySuffix?: string;
  configuredProviders: AiProviderId[];
  providerModels: Record<AiProviderId, string>;
  usingBuiltInService: boolean;
}

export interface SaveAiSettingsInput {
  provider: AiProviderId;
  model: string;
  apiKey?: string;
}

export interface SaveBookmarkInput {
  capture: PageCapture;
  /** 发起收藏时的真实网页标签页。不能在保存结束后重新猜测活动标签页。 */
  sourceTabId?: number;
  title: string;
  userNote: string;
  folderId: string;
  requestAi: true;
  existingBookmarkId?: string;
  createSeparate?: boolean;
  confirmedCanonicalReuse?: boolean;
}

export interface SaveBookmarkResult {
  resource: ResourceRecord;
  nativeBookmarkCreated: boolean;
  cloudSyncAttempted: boolean;
  aiWarning?: string;
  enhancementPending: boolean;
}

export interface UpdateBookmarkDetailsInput {
  bookmarkId: string;
  resourceKey: string;
  title: string;
  url: string;
  parentId: string;
  tags: string[];
  tagsChanged: boolean;
  userNote: string;
}

export interface UpdateBookmarkDetailsResult {
  bookmark: NativeBookmarkNode;
  resource: ResourceRecord;
  urlChanged: boolean;
}

export interface BookmarkAgentSource {
  resourceKey: string;
  title: string;
  url: string;
  siteName: string;
  faviconUrl: string;
}

export type BookmarkAgentActionType =
  | "create_bookmark"
  | "create_folder"
  | "delete_bookmark"
  | "delete_folder"
  | "update_bookmark"
  | "rename_folder"
  | "move_bookmark"
  | "move_folder";

export type BookmarkAgentActionStatus =
  | "pending"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export interface BookmarkAgentCatalogBookmark {
  id: string;
  parentId: string;
  title: string;
  url: string;
  path: string[];
  writable: boolean;
  dateAdded?: number;
  dateLastUsed?: number;
}

export interface BookmarkAgentCatalogFolder {
  id: string;
  parentId?: string;
  title: string;
  path: string[];
  writable: boolean;
}

export interface BookmarkAgentCatalog {
  bookmarks: BookmarkAgentCatalogBookmark[];
  folders: BookmarkAgentCatalogFolder[];
}

export interface BookmarkAgentActionProposal {
  id: string;
  type: BookmarkAgentActionType;
  label: string;
  description: string;
  destructive: boolean;
  status: BookmarkAgentActionStatus;
  targetId?: string;
  parentId?: string;
  destinationId?: string;
  expectedTitle?: string;
  expectedUrl?: string;
  expectedParentId?: string;
  title?: string;
  url?: string;
  resultMessage?: string;
}

export interface BookmarkAgentActionExecutionResult {
  actionId: string;
  success: boolean;
  message: string;
  createdNodeId?: string;
}

export type UndoMutationKind =
  | "remove_created"
  | "restore_subtree"
  | "restore_update"
  | "restore_move";

export interface UndoMutation {
  id: string;
  actionId?: string;
  kind: UndoMutationKind;
  label: string;
  destructive: boolean;
  applied: boolean;
  node?: NativeBookmarkNode;
  parentId?: string;
  beforeChildIds?: string[];
  expectedTitle?: string;
  expectedUrl?: string;
  createdNodeId?: string;
}

export type UndoSnapshotStatus = "pending" | "ready" | "undone" | "partial";

export interface UndoSnapshotBatch {
  batchId: string;
  source: "agent" | "manual" | "chrome";
  label: string;
  destructive: boolean;
  createdAt: string;
  expiresAt: string;
  status: UndoSnapshotStatus;
  mutations: UndoMutation[];
  resultMessages?: string[];
  undoneAt?: string;
}

export interface UndoBatchResult {
  batch: UndoSnapshotBatch;
  restored: number;
  failed: number;
  messages: string[];
}

export interface BookmarkAgentResponse {
  query: string;
  answer: string;
  providerName: string;
  sources: BookmarkAgentSource[];
  actions: BookmarkAgentActionProposal[];
  catalogSize: number;
  examinedCount: number;
}

export interface BookmarkAgentTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  providerName?: string;
  sources?: BookmarkAgentSource[];
  actions?: BookmarkAgentActionProposal[];
  undoBatchId?: string;
  status?: "sending" | "complete" | "failed";
}

export interface AgentConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentChatMessage[];
}

export type LibraryScanState =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface LibraryScanError {
  resourceKey: string;
  title: string;
  message: string;
}

export interface LibraryScanStatus {
  id: string;
  state: LibraryScanState;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentTitle: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  errors: LibraryScanError[];
  concurrency?: number;
  estimatedMinutes?: number;
  estimatedCostCny?: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  actualCachedInputTokens?: number;
  actualCostCny?: number;
  pricingUpdatedAt?: string;
  providerName?: string;
  model?: string;
}

export interface LibraryScanEstimate {
  total: number;
  aiResourceCount: number;
  concurrency: number;
  estimatedMinutes: number;
  estimatedCostCny?: number;
  pricingUpdatedAt: string;
  providerName?: string;
  model?: string;
  priceAvailable: boolean;
}

export type SnapshotBackfillState =
  | "idle"
  | "running"
  | "waiting_focus"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface SnapshotBackfillError {
  resourceKey: string;
  title: string;
  message: string;
}

/**
 * 页面截图只能通过 captureVisibleTab 获取当前可见标签页，因此批量补拍
 * 永远是用户主动启动的单并发前台任务。waiting_focus 表示任务仍可继续，
 * 但 Aarre 不会擅自把标签页或窗口抢回前台。
 */
export interface SnapshotBackfillStatus {
  id: string;
  state: SnapshotBackfillState;
  /**
   * 仅在管理页显式请求时按 pageSnapshots 实存计算，不写入任务状态。
   * 这样即使旧快照被容量策略淘汰，也不会被陈旧 snapshotAt 隐藏入口。
   */
  candidateCount?: number;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentTitle: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  errors: SnapshotBackfillError[];
  concurrency: 1;
  requiresForeground: true;
  tabId?: number;
}

export type OrganizationProposalKind =
  | "classify"
  | "duplicate"
  | "dead"
  | "large_folder";

export interface OrganizationProposal {
  id: string;
  kind: OrganizationProposalKind;
  title: string;
  description: string;
  destructive: boolean;
  selectedByDefault: boolean;
  actions: BookmarkAgentActionProposal[];
  resourceKeys: string[];
  beforePaths: string[];
  afterPath?: string;
  previewLines: string[];
  recoveryLinks?: Array<{
    label: string;
    url: string;
  }>;
}

export interface OrganizationPlan {
  generatedAt: string;
  proposalCount: number;
  actionableCount: number;
  proposals: OrganizationProposal[];
}

export interface ReadingQueueItem {
  nodeId: string;
  resourceKey: string;
  title: string;
  url: string;
  path: string[];
  dateAdded?: number;
  dateLastUsed?: number;
}

export interface FolderSuggestion {
  folderId: string;
  name: string;
  path: string[];
  score: number;
  reason: string;
}

export interface LibraryInsights {
  organizationPlan: OrganizationPlan;
  readingQueue: ReadingQueueItem[];
}

export interface OrganizationNotice {
  generatedAt: string;
  signature: string;
  proposalCount: number;
  actionableCount: number;
  counts: {
    duplicate: number;
    dead: number;
    classify: number;
    largeFolder: number;
  };
}

export interface ResurfacingItem {
  resourceKey: string;
  title: string;
  url: string;
  path: string[];
  ageDays: number;
  score: number;
  reason: string;
}

export interface TopicTrend {
  topic: string;
  current: number;
  previous: number;
}

export interface KnowledgeGap {
  topic: string;
  resourceCount: number;
  angleCount: number;
  message: string;
}

export interface LibraryReport {
  period: "week" | "month";
  startAt: string;
  endAt: string;
  createdCount: number;
  attentionShift: string;
  topicTrends: TopicTrend[];
  rarelyOpenedOver90Days: number;
  knowledgeGaps: KnowledgeGap[];
  resurfacing: ResurfacingItem[];
  health: {
    deadLinks: number;
    newlyDetectedDeadLinks: number;
    largeFolders: number;
  };
}

export interface TopicGraphNode {
  id: string;
  label: string;
  count: number;
}

export interface TopicGraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface TopicGraph {
  nodes: TopicGraphNode[];
  edges: TopicGraphEdge[];
}

export interface KnowledgeDashboard {
  weekly: LibraryReport;
  monthly: LibraryReport;
  topicGraph: TopicGraph;
  resurfacing: ResurfacingItem[];
}

export interface PageEssence {
  description: string;
  siteName: string;
  imageUrl: string;
  faviconUrl: string;
  manifestUrl: string;
  siteIconCandidates: SiteIconCandidate[];
  keywords: string[];
  ogType: string;
  h1: string;
  h2: string[];
  firstParagraph: string;
  pathTokens: string[];
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

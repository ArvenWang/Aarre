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
  /** H1 followed by the first few H2s. Optional so existing empty captures
   *  and stored drafts stay valid. */
  headings?: string[];
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
  /** Situations in which this page is worth reopening. This is how people
   *  actually recall a bookmark, so it carries real retrieval weight. */
  useCases?: string[];
  /** One of AI_CONTENT_TYPES. */
  contentType?: string;
  /** Verbatim questions the user might type to find this page again. Highest
   *  weight in the search index. */
  questions?: string[];
  /** Product, company and technology names mentioned on the page. */
  entities?: string[];
  /** Metadata contract version successfully produced by AI. This prevents an
   *  optional empty field from making the same bookmark billable forever. */
  aiSchemaVersion?: number;
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
  /** `user` 表示封面由用户显式指定，自动采集与云端恢复都不得覆盖它。 */
  coverOrigin?: "user" | "auto";
  /** 当前封面内容的 SHA-256，用于与云端资产对账，不依赖时间戳。 */
  coverContentHash?: string;
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
  /** 本地已删除，等待把删除墓碑推送到云端。 */
  deletedAt?: string;
  /**
   * 每个可同步字段最后一次真正变化的时间，由 upsertLocalResource 自动维护。
   *
   * 云端按字段而非按整条记录裁决冲突，因此两台设备各自修改不同字段时都能保留。
   * 记录级的 updatedAt 无法表达这一点：它会让最近写过任何字段的一方赢下所有字段。
   */
  fieldUpdatedAt?: Record<string, string>;
}

export type SiteIconSource =
  | "registry"
  | "capture-favicon"
  | "apple-touch-icon"
  | "conventional-apple-touch-icon"
  | "conventional-favicon-ico"
  | "manifest"
  | "svg-icon"
  | "large-icon"
  | "msapplication-tile"
  | "public-service";

export interface SiteIconCandidate {
  url: string;
  source: SiteIconSource;
  declaredSize?: number;
  vector?: boolean;
}

export interface SiteBrandRecord {
  host: string;
  /** 兼容 0.3.4 及更早版本；新记录与当前透明缓存相同。 */
  iconDataUrl?: string;
  iconDataUrlLight?: string;
  /** 仅为读取旧缓存保留；显示层和新生成流程均不再使用。 */
  iconDataUrlDark?: string;
  iconRenderVersion?: number;
  iconSource?: SiteIconSource;
  iconAssetUrl?: string;
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

export interface VisualAsset {
  /** `site-icon:<host>` 或 `cover:<resourceKey>`。 */
  key: string;
  kind: "site-icon" | "cover";
  /** host 或 resourceKey。 */
  identity: string;
  /** 二进制是唯一的新存储格式；旧 dataURL 字段仅保留一版回滚。 */
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  origin: "user" | "auto";
  source: string;
  contentHash: string;
  updatedAt: string;
  renderVersion: number;
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
  aiEligibleResourceCount: number;
  aiPrivacyProtectedCount: number;
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
  | "move_folder"
  /** Aarre-only: tags, note and summary. Never touches Chrome. */
  | "update_metadata";

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
  /** Set when several proposals answer one semantic instruction, e.g.
   *  「把所有设计类收藏移到设计文件夹」. The UI folds them into a single
   *  confirm card showing the hit list. */
  groupLabel?: string;
  resourceKey?: string;
  tags?: string[];
  userNote?: string;
  summary?: string;
  /** 新文件夹尚无 Chrome ID 时，用路径在执行阶段解析。 */
  plannedPath?: string;
  targetFolderPath?: string;
  selected?: boolean;
  resultMessage?: string;
}

export interface ResourceMetadataPatch {
  tags?: string[];
  tagsSource?: "ai" | "user";
  userNote?: string;
  summary?: string;
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
  | "restore_move"
  | "restore_metadata";

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
  resourceKey?: string;
  beforeMetadata?: ResourceMetadataPatch;
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
  /** 模型先思考生成的回答路径，最终回答必须按它展开；可能为空。 */
  thinking: string[];
  providerName: string;
  sources: BookmarkAgentSource[];
  actions: BookmarkAgentActionProposal[];
  catalogSize: number;
  /** Bookmarks intentionally kept out of provider prompts by privacy rules. */
  excludedCount: number;
}

export interface BookmarkAgentTurn {
  role: "user" | "assistant";
  content: string;
}

export type BookmarkAgentProgressStage =
  | "preparing"
  | "scanning"
  | "selecting"
  | "thinking"
  | "synthesizing";

export interface BookmarkAgentProgress {
  requestId: string;
  stage: BookmarkAgentProgressStage;
  /** Only stages that this request will actually execute. */
  stages: BookmarkAgentProgressStage[];
  completedStages: BookmarkAgentProgressStage[];
  completed: number;
  total: number;
  label: string;
}

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  thinking?: string[];
  providerName?: string;
  sources?: BookmarkAgentSource[];
  actions?: BookmarkAgentActionProposal[];
  undoBatchId?: string;
  status?: "sending" | "complete" | "failed" | "cancelled";
  progress?: BookmarkAgentProgress;
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
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
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
 * 批量补拍通过 chrome.debugger 对后台专用标签页截图，不再要求前台窗口，
 * 用户可以在任务运行时正常使用 Chrome。waiting_focus 仅用于兼容旧任务。
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
  /** 固定的后台补拍 worker 数，避免把机器资源无限并行化。 */
  concurrency: 3;
  /** 当前正在加载或等待截图的 worker 数。 */
  activeCount?: number;
  requiresForeground: boolean;
  tabId?: number;
}

export type OrganizationProposalKind =
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

export interface FolderSuggestion {
  folderId: string;
  name: string;
  path: string[];
  score: number;
  reason: string;
}

export interface LibraryInsights {
  organizationPlan: OrganizationPlan;
}

export interface OrganizationNotice {
  generatedAt: string;
  signature: string;
  proposalCount: number;
  actionableCount: number;
  counts: {
    duplicate: number;
    dead: number;
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

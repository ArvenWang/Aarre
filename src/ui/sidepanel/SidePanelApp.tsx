import { AgentComposer } from "./components/AgentComposer";
import { BookmarkEditorDialog } from "./components/BookmarkEditorDialog";
import { AppModal } from "@/ui/components/ui/modal";
import { Button } from "@/ui/components/ui/button";
import { X } from "lucide-react";
import { FloatingShell } from "../floating/FloatingShell";
import { FLOATING_VIEW_EVENT } from "../floating/bridge";
import { useFloatingSave } from "../floating/use-floating-save";
import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from "react";
import { sendExtensionRequest } from "../../lib/messages";
import type { ListCoverStyle } from "../../lib/display-settings";
import { restartOnboarding } from "../../lib/onboarding";
import { useScrollBoundary } from "./hooks/use-scroll-boundary";
import { useBookmarkPreview } from "./hooks/use-bookmark-preview";
import { useAgentChat, type SidePanelView } from "./hooks/use-agent-chat";
import { useBookmarks } from "./hooks/use-bookmarks";
import { useAppState } from "./hooks/use-app-state";
import { useBookmarkEditor } from "./hooks/use-bookmark-editor";
import { usePendingSave } from "./hooks/use-pending-save";
import { useSidepanelPersistence } from "./hooks/use-sidepanel-persistence";
import { useNavigation } from "./hooks/use-navigation";
import HomePage from "./pages/HomePage";
export { decideBookmarkPreviewMove } from "./components/BookmarkTree";
export { BookmarkPreviewLayer } from "./components/BookmarkPreview";
export { highlightTextMatches } from "./components/highlightTextMatches";
const AgentChatPage = lazy(() => import("./pages/AgentChatPage"));
const AgentHistoryPage = lazy(() => import("./pages/AgentHistoryPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

export function SidePanelApp({ surface = "sidebar" }: { surface?: "sidebar" | "floating" } = {}) {
  const [listCoverStyle, setListCoverStyle] = useState<ListCoverStyle>("site");
  const [publicFaviconFallback, setPublicFaviconFallback] = useState(true);
  const [pageSnapshotsEnabled, setPageSnapshotsEnabled] = useState(true);
  const [onboardingVisible, setOnboardingVisible] = useState<boolean>(() =>
    new URLSearchParams(location.search).has("onboarding") || localStorage.getItem("aarre:onboarding-done") !== "1"
  );
  const [panelView, setWorkspaceView] = useState<SidePanelView>("library");
  const [utilityView, setUtilityView] = useState<"settings" | "history" | null>(null);
  const setPanelView = useCallback((next: SidePanelView) => {
    if (surface === "floating" && (next === "settings" || next === "history")) setUtilityView(next);
    else { setWorkspaceView(next); setUtilityView(null); }
  }, [surface]);
  const [emptyConversation] = useState(() => ({ id: crypto.randomUUID(), title: "问问你的收藏", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  useEffect(() => {
    const handle = (event: Event) => { const view = (event as CustomEvent<string>).detail; if (["library", "chat", "settings", "history"].includes(view)) setPanelView(view as SidePanelView); };
    window.addEventListener(FLOATING_VIEW_EVENT, handle);
    return () => window.removeEventListener(FLOATING_VIEW_EVENT, handle);
  }, [setPanelView]);
  const applyDisplaySettings = useCallback((settings: {
    listCoverStyle: ListCoverStyle;
    pageSnapshotsEnabled: boolean;
    publicFaviconFallback: boolean;
  }) => {
    setListCoverStyle(settings.listCoverStyle);
    setPageSnapshotsEnabled(settings.pageSnapshotsEnabled);
    setPublicFaviconFallback(settings.publicFaviconFallback);
  }, []);
  const {
    placement: bookmarkPreview,
    snapshot: previewSnapshot,
    show: showBookmarkPreview,
    close: closeBookmarkPreview,
    keepOpen: keepBookmarkPreviewOpen,
    dismiss: dismissBookmarkPreviewImmediately,
  } = useBookmarkPreview();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dismissError = useCallback(() => setError(""), []);
  const dismissNotice = useCallback(() => setNotice(""), []);
  const {
    snapshot,
    appState,
    setAppState,
    resources,
    siteBrands,
    aiConfigured,
    setAiConfigured,
    refresh,
  } = useAppState(setError, applyDisplaySettings);
  const editorController = useBookmarkEditor({
    appState,
    snapshot,
    resources,
    pageSnapshotsEnabled,
    busy,
    setBusy,
    setError,
    setNotice,
    refresh,
    dismissPreview: dismissBookmarkPreviewImmediately,
  });
  const {
    editor,
    setEditor,
    dialogRef,
    editBookmarkId,
    editParentId,
    setEditParentId,
    editTitle,
    setEditTitle,
    editUrl,
    setEditUrl,
    editTags,
    setEditTags,
    editTagInput,
    setEditTagInput,
    setEditTagsChanged,
    capture,
    note,
    setNote,
    folderId,
    setFolderId,
    folders,
    folderSuggestions,
    bookmarkSaveState,
    saveDisposition,
    setSaveDisposition,
    selectedBookmarkId,
    setSelectedBookmarkId,
    captureWarning,
    confirmDeleteId,
    setConfirmDeleteId,
    removedNodeIds,
    currentSaved,
    selectedSaveMatch,
    editorResource,
    editorModel,
    selectedEditorLocation,
    editorWritable,
    startSave,
    startEdit,
    startCreateFolder,
    addEditTags,
    resetEditLocation,
    saveEditor,
    deleteEditorNode,
  } = editorController;
  usePendingSave({ activeTabId: appState?.activeTab?.id, startSave, setError });
  useFloatingSave({
    enabled: surface === "floating", ready: Boolean(appState?.activeTab), busy: Boolean(busy), editorKind: editor?.kind,
    onOpen: () => { setOnboardingVisible(false); setUtilityView(null); void startSave(); },
    onDeferred: () => setNotice("请先完成当前操作，再添加收藏。正在编辑的内容已保留。"),
  });
  const { contentRef, atEnd, sync: syncScrollBoundary } = useScrollBoundary(panelView);

  const {
    expanded,
    setExpanded,
    query: libraryQuery,
    debouncedQuery: debouncedLibraryQuery,
    searchMode: librarySearchMode,
    setSearchMode: setLibrarySearchMode,
    draggedId,
    setDraggedId,
    resourceByUrl,
    siteBrandByHost,
    rankedNativeResults,
    visibleNodes: visibleBookmarkNodes,
    visibleExpanded,
    hasVisibleFolders,
    clearSearch: clearLibrarySearch,
    changeQuery: handleLibraryQueryChange,
    moveNode,
  } = useBookmarks({
    snapshot,
    resources,
    siteBrands,
    removedNodeIds,
    contentRef,
    syncScrollThumb: syncScrollBoundary,
    refresh,
    setError,
  });

  const {
    prompt: agentPrompt,
    setPrompt: setAgentPrompt,
    conversations,
    activeConversation,
    setActiveConversation,
    loadConversations,
    deleteConversation,
    cancelRun: cancelAgentRun,
    confirmActions: handleConfirmAgentActions,
    dropAction: handleDropAgentAction,
    toggleAction: handleToggleAgentAction,
    cancelActions: handleCancelAgentActions,
    undoBatch: handleUndoAgentBatch,
    submit: submitAgentQuery,
    regenerate: regenerateAgentAnswer,
    editQuestion: editAgentQuestion,
    copyAnswer: copyAgentAnswer,
  } = useAgentChat({
    busy,
    setBusy,
    setError,
    setNotice,
    aiConfigured,
    panelView,
    setPanelView,
    refresh,
  });
  const handleContentScroll = useSidepanelPersistence({
    panelView,
    onboardingVisible,
    setOnboardingVisible,
    expanded,
    setExpanded,
    contentRef,
    syncScrollThumb: syncScrollBoundary,
    revealScrollThumb: syncScrollBoundary,
    loadConversations,
    setError,
  });
  const openNavigation = useNavigation(pageSnapshotsEnabled, setError);

  function handleAgentSubmit(event: React.FormEvent) {
    event.preventDefault();
    submitAgentQuery(agentPrompt);
  }

  const focusComposer = () => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("#bookmark-agent-prompt")?.focus());
  const closeUtility = () => { setUtilityView(null); void refresh().catch(caught => setError(caught instanceof Error ? caught.message : "刷新设置失败")); focusComposer(); };
  const currentView = panelView === "chat" && activeConversation ? "chat" : "library";
  const renderSurface = (children: ReactNode) => surface === "floating"
    ? <>
      <FloatingShell view={currentView} onViewChange={setPanelView} onboarding={onboardingVisible}
        conversationTitle={activeConversation?.title}
        busy={Boolean(busy)} currentSaved={currentSaved} canSave={Boolean(appState?.activeTab?.supported)} canCreateFolder={Boolean(snapshot)}
        onSaveCurrent={() => void startSave()} onCreateFolder={() => snapshot && startCreateFolder(snapshot.primaryRootId || snapshot.root.id)}
        onNewConversation={() => { setActiveConversation(null); setAgentPrompt(""); setPanelView("library"); focusComposer(); }}
        onHistory={() => { void loadConversations().then(() => setUtilityView("history")).catch(caught => setError(caught instanceof Error ? caught.message : "历史会话读取失败")); }}
        composer={<AgentComposer value={agentPrompt} onChange={setAgentPrompt} onSubmit={handleAgentSubmit}
          configured={aiConfigured} busy={Boolean(busy)} onConfigure={() => setUtilityView("settings")}
          onResume={currentView === "library" && activeConversation ? () => setPanelView("chat") : undefined}
          onCancel={busy === "agent" || busy === "agent-actions" ? () => void cancelAgentRun() : undefined} />}>
        {children}
      </FloatingShell>
      {!onboardingVisible && <BookmarkEditorDialog error={error} presentation={editor?.kind === "save" ? "page" : "dialog"} controller={editorController} busy={busy} setNotice={setNotice} refresh={refresh} />}
      {utilityView && <AppModal labelledBy="floating-utility-title" className="floating-utility-dialog" onClose={closeUtility}>
        <header className="floating-utility-heading"><h2 id="floating-utility-title">{utilityView === "settings" ? "设置" : "历史会话"}</h2><Button variant="ghost" size="icon-sm" aria-label="关闭窗口" onClick={closeUtility}><X size={16}/></Button></header>
        <Suspense fallback={<p className="utility-loading" role="status">正在打开…</p>}>
          {utilityView === "settings" ? <SettingsPage appState={appState} publicFaviconFallback={publicFaviconFallback}
            onPublicFaviconFallbackChange={setPublicFaviconFallback} onAppStateChange={setAppState} onAiConfiguredChange={setAiConfigured}
            onClose={closeUtility} onRestartOnboarding={() => { void restartOnboarding().then(() => { localStorage.removeItem("aarre:onboarding-done"); setUtilityView(null); setOnboardingVisible(true); }); }} />
            : <AgentHistoryPage conversations={conversations} onDelete={deleteConversation} onBack={closeUtility}
              onOpen={conversation => { setActiveConversation(conversation); setAgentPrompt(""); setError(""); setPanelView("chat"); focusComposer(); }} />}
        </Suspense>
      </AppModal>}
    </>
    : children;

  if (onboardingVisible) {
    return renderSurface(
      <Suspense fallback={null}>
        <OnboardingPage
          resourceCount={
            snapshot?.bookmarkCount || appState?.localResourceCount || 0
          }
          initialAiConfigured={aiConfigured}
          onComplete={(_skipped, configured) => {
            if (configured) setAiConfigured(true);
            localStorage.setItem("aarre:onboarding-done", "1");
            setOnboardingVisible(false);
            const url = new URL(location.href); url.searchParams.delete("onboarding"); history.replaceState(null, "", url);
            void refresh();
          }}
        />
      </Suspense>
    );
  }

  if (panelView === "settings") {
    return renderSurface(
      <Suspense fallback={null}>
        <SettingsPage
          appState={appState}
          publicFaviconFallback={publicFaviconFallback}
          onPublicFaviconFallbackChange={setPublicFaviconFallback}
          onRestartOnboarding={() => {
            void restartOnboarding().then(() => {
              localStorage.removeItem("aarre:onboarding-done");
              setPanelView("library");
              setOnboardingVisible(true);
            });
          }}
          onAppStateChange={setAppState}
          onClose={() => {
            setPanelView("library");
            void refresh();
          }}
        />
      </Suspense>
    );
  }

  if (panelView === "history") {
    return renderSurface(
      <Suspense fallback={null}>
        <AgentHistoryPage
          conversations={conversations}
          onDelete={deleteConversation}
          onBack={() => setPanelView("library")}
          onOpen={(conversation) => {
            setActiveConversation(conversation);
            setAgentPrompt("");
            setError("");
            setPanelView("chat");
          }}
        />
      </Suspense>
    );
  }

  if (panelView === "chat" && (surface !== "floating" || activeConversation)) {
    return renderSurface(
      <Suspense fallback={null}>
        <AgentChatPage
        embedded={surface === "floating"}
        conversation={activeConversation || emptyConversation}
        resourceByUrl={resourceByUrl}
        siteBrandByHost={siteBrandByHost}
        prompt={agentPrompt}
        busy={busy === "agent" || busy === "agent-actions"}
        configured={aiConfigured}
        error={error}
        onPromptChange={setAgentPrompt}
        onConfigure={() => setPanelView("settings")}
        onCancel={
          busy === "agent" ? () => void cancelAgentRun() : undefined
        }
        onBack={() => {
          setError("");
          setPanelView("library");
        }}
        onSubmit={handleAgentSubmit}
        onOpenSource={(url) => void openNavigation({ text: url, url }, true)}
        onRegenerate={regenerateAgentAnswer}
        onEditQuestion={editAgentQuestion}
        onCopyAnswer={(messageId) => void copyAgentAnswer(messageId)}
        onConfirmActions={(messageId) =>
          void handleConfirmAgentActions(messageId)
        }
        onCancelActions={handleCancelAgentActions}
        onDropAction={handleDropAgentAction}
        onToggleAction={handleToggleAgentAction}
        onUndoBatch={(messageId, batchId) =>
          void handleUndoAgentBatch(messageId, batchId)
        }
        />
      </Suspense>
    );
  }

  return renderSurface(
    <HomePage
      floating={surface === "floating"}
      header={{
        appState,
        hasSnapshot: Boolean(snapshot),
        currentSaved,
        onCreateFolder: () => snapshot && startCreateFolder(snapshot.primaryRootId || snapshot.root.id),
        onSaveCurrent: () => void startSave(),
        onOpenHistory: () => { void loadConversations(); setPanelView("history"); },
        onOpenManager: () => void sendExtensionRequest({ type: "OPEN_MANAGER" }),
        onOpenSettings: () => setPanelView("settings"),
      }}
      search={{
        value: libraryQuery,
        onChange: handleLibraryQueryChange,
        onClear: clearLibrarySearch,
        onSubmit: () => setLibrarySearchMode("ranked"),
      }}
      status={{
        error,
        notice,
        onRetry: () => void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : "重新读取失败")),
        onDismissError: dismissError,
        onDismissNotice: dismissNotice,
      }}
      library={{
        snapshot,
        searchMode: librarySearchMode,
        query: libraryQuery,
        debouncedQuery: debouncedLibraryQuery,
        rankedResults: rankedNativeResults,
        visibleNodes: visibleBookmarkNodes,
        resourceByUrl,
        siteBrandByHost,
        coverStyle: listCoverStyle,
        expanded: visibleExpanded,
        draggedId,
        hasVisibleFolders,
        contentRef,
        onContentScroll: handleContentScroll,
        onSetSearchMode: setLibrarySearchMode,
        onOpen: (node, newTab) => void openNavigation({ text: node.url || "", url: node.url }, newTab),
        onEdit: startEdit,
        onPreviewIntent: showBookmarkPreview,
        onPreviewLeave: closeBookmarkPreview,
        onToggle: (id) => setExpanded((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        }),
        onDragStart: setDraggedId,
        onDragEnd: () => setDraggedId(""),
        onMove: moveNode,
      }}
      scroll={{ atEnd }}
      preview={{ snapshot: previewSnapshot, hidden: Boolean(editor), placement: bookmarkPreview }}
      agent={aiConfigured ? {
        value: agentPrompt,
        busy: Boolean(busy),
        configured: true,
        onChange: setAgentPrompt,
        onSubmit: handleAgentSubmit,
        onCancel: busy === "agent" ? () => void cancelAgentRun() : undefined,
        onConfigure: () => setPanelView("settings"),
      } : null}
      editor={{ controller: editorController, busy, setNotice, refresh }}
    />
  );
}

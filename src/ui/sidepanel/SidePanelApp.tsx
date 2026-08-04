import { Suspense, lazy, useCallback, useState } from "react";
import { sendExtensionRequest } from "../../lib/messages";
import type { ListCoverStyle } from "../../lib/display-settings";
import { restartOnboarding } from "../../lib/onboarding";
import { useScrollThumb } from "./hooks/use-scroll-thumb";
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

export function SidePanelApp() {
  const [organizationNoticeBusy, setOrganizationNoticeBusy] = useState(false);
  const [listCoverStyle, setListCoverStyle] = useState<ListCoverStyle>("site");
  const [publicFaviconFallback, setPublicFaviconFallback] = useState(true);
  const [pageSnapshotsEnabled, setPageSnapshotsEnabled] = useState(true);
  const [onboardingVisible, setOnboardingVisible] = useState<boolean>(() =>
    localStorage.getItem("aarre:onboarding-done") !== "1"
  );
  const [panelView, setPanelView] = useState<SidePanelView>("library");
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
    contextResurfacing,
    organizationNotice,
    setOrganizationNotice,
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
  const {
    contentRef,
    thumb: scrollThumb,
    sync: syncScrollThumb,
    reveal: revealScrollThumb,
    onPointerDown: handleScrollThumbPointerDown,
    onPointerMove: handleScrollThumbPointerMove,
    onPointerEnd: handleScrollThumbPointerEnd,
  } = useScrollThumb(panelView);

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
    syncScrollThumb,
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
    syncScrollThumb,
    revealScrollThumb,
    loadConversations,
    setError,
  });
  const openNavigation = useNavigation(pageSnapshotsEnabled, setError);

  function handleAgentSubmit(event: React.FormEvent) {
    event.preventDefault();
    submitAgentQuery(agentPrompt);
  }

  if (onboardingVisible) {
    return (
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
            void refresh();
          }}
        />
      </Suspense>
    );
  }

  if (panelView === "settings") {
    return (
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
    return (
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

  if (panelView === "chat" && activeConversation) {
    return (
      <Suspense fallback={null}>
        <AgentChatPage
        conversation={activeConversation}
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

  return (
    <HomePage
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
      notices={{
        query: libraryQuery,
        organizationNotice,
        organizationNoticeBusy,
        resurfacing: contextResurfacing,
        onDismissOrganization: () => {
          setOrganizationNoticeBusy(true);
          void sendExtensionRequest({ type: "DISMISS_ORGANIZATION_NOTICE" })
            .then(() => setOrganizationNotice(null))
            .catch((caught) => setError(caught instanceof Error ? caught.message : "暂时无法隐藏整理提示"))
            .finally(() => setOrganizationNoticeBusy(false));
        },
        onOpenOrganization: () => void sendExtensionRequest({ type: "OPEN_MANAGER", view: "organize" })
          .catch((caught) => setError(caught instanceof Error ? caught.message : "无法打开整理提案")),
        onOpenResurfacing: () => void sendExtensionRequest({ type: "OPEN_MANAGER", view: "resurface" }),
        onOpenItem: (item) => void openNavigation({ text: item.url, url: item.url }),
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
      scroll={{
        ...scrollThumb,
        onPointerDown: handleScrollThumbPointerDown,
        onPointerMove: handleScrollThumbPointerMove,
        onPointerEnd: handleScrollThumbPointerEnd,
      }}
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

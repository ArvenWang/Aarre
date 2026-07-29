const SIDEPANEL_STATE_KEY = "aarre:sidepanel-state";

export interface SidepanelPersistentState {
  expandedFolderIds: string[];
  scrollTop: number;
}

const EMPTY_STATE: SidepanelPersistentState = {
  expandedFolderIds: [],
  scrollTop: 0
};

export async function getSidepanelState(): Promise<SidepanelPersistentState> {
  const stored = (await chrome.storage.local.get(SIDEPANEL_STATE_KEY))[
    SIDEPANEL_STATE_KEY
  ] as Partial<SidepanelPersistentState> | undefined;
  return {
    expandedFolderIds: Array.isArray(stored?.expandedFolderIds)
      ? stored.expandedFolderIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, 2_000)
      : [],
    scrollTop:
      typeof stored?.scrollTop === "number" &&
      Number.isFinite(stored.scrollTop)
        ? Math.max(0, stored.scrollTop)
        : EMPTY_STATE.scrollTop
  };
}

export async function saveSidepanelState(
  state: SidepanelPersistentState
): Promise<void> {
  await chrome.storage.local.set({
    [SIDEPANEL_STATE_KEY]: {
      expandedFolderIds: [...new Set(state.expandedFolderIds)].slice(
        0,
        2_000
      ),
      scrollTop: Math.max(0, Math.round(state.scrollTop))
    } satisfies SidepanelPersistentState
  });
}

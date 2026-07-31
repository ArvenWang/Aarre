const SIDEPANEL_STATE_KEY = "aarre:sidepanel-state";

export interface SidepanelPersistentState {
  expandedFolderIds: string[];
  scrollTop: number;
}

const EMPTY_STATE: SidepanelPersistentState = {
  expandedFolderIds: [],
  scrollTop: 0
};

async function readStoredState(): Promise<Partial<SidepanelPersistentState> | undefined> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    return (
      await chrome.storage.local.get(SIDEPANEL_STATE_KEY)
    )[SIDEPANEL_STATE_KEY] as Partial<SidepanelPersistentState> | undefined;
  }
  try {
    const raw = localStorage.getItem(SIDEPANEL_STATE_KEY);
    return raw ? (JSON.parse(raw) as Partial<SidepanelPersistentState>) : undefined;
  } catch {
    return undefined;
  }
}

export async function getSidepanelState(): Promise<SidepanelPersistentState> {
  const stored = await readStoredState();
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
  const nextState = {
    expandedFolderIds: [...new Set(state.expandedFolderIds)].slice(0, 2_000),
    scrollTop: Math.max(0, Math.round(state.scrollTop))
  } satisfies SidepanelPersistentState;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({ [SIDEPANEL_STATE_KEY]: nextState });
    return;
  }
  try {
    localStorage.setItem(SIDEPANEL_STATE_KEY, JSON.stringify(nextState));
  } catch {
    // 本地预览或隐私模式禁用存储时，状态只在当前会话内存在。
  }
}

export const CONTEXT_MENU_PAGE_ID = "bookmark-layer-save-page";
export const CONTEXT_MENU_LINK_ID = "bookmark-layer-save-link";
export const CONTEXT_MENU_UPDATE_SNAPSHOT_ID = "bookmark-layer-update-snapshot";
export const CONTEXT_MENU_IMAGE_COVER_ID = "bookmark-layer-image-cover";

export function pendingSaveKey(tabId: number): string {
  return `pending-save:${tabId}`;
}

export function configureActionSidePanelBehavior(): Promise<void> {
  return chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

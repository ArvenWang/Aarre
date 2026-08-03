import { useEffect, useRef } from "react";
import { getOnboardingState } from "../../../lib/onboarding";
import { getSidepanelState, saveSidepanelState } from "../../../lib/sidepanel-state";
import type { AgentConversation } from "../../../lib/types";
import type { SidePanelView } from "./use-agent-chat";

interface UseSidepanelPersistenceInput {
  panelView: SidePanelView;
  onboardingVisible: boolean;
  setOnboardingVisible: (value: boolean) => void;
  expanded: Set<string>;
  setExpanded: (value: Set<string>) => void;
  contentRef: React.RefObject<HTMLElement | null>;
  syncScrollThumb: () => void;
  revealScrollThumb: () => void;
  loadConversations: () => Promise<AgentConversation[]>;
  setError: (value: string) => void;
}

export function useSidepanelPersistence({
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
}: UseSidepanelPersistenceInput) {
  const loaded = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void Promise.all([getSidepanelState(), getOnboardingState()])
      .then(([persisted, onboarding]) => {
        setExpanded(new Set(persisted.expandedFolderIds));
        if (onboarding.completed) {
          localStorage.setItem("aarre:onboarding-done", "1");
        } else {
          localStorage.removeItem("aarre:onboarding-done");
        }
        setOnboardingVisible(!onboarding.completed);
        window.requestAnimationFrame(() => {
          if (contentRef.current) contentRef.current.scrollTop = persisted.scrollTop;
          loaded.current = true;
        });
      })
      .catch(() => {
        loaded.current = true;
      });
    const conversationsTimer = window.setTimeout(() => {
      void loadConversations().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "历史会话读取失败");
      });
    }, 1_000);
    return () => window.clearTimeout(conversationsTimer);
  }, [contentRef, loadConversations, setError, setExpanded, setOnboardingVisible]);

  useEffect(() => () => {
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    void saveSidepanelState({
      expandedFolderIds: [...expanded],
      scrollTop: contentRef.current?.scrollTop || 0,
    });
  }, [contentRef, expanded]);

  useEffect(() => {
    if (panelView !== "library" || onboardingVisible !== false || !loaded.current) return;
    void getSidepanelState().then((persisted) => {
      window.requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = persisted.scrollTop;
          syncScrollThumb();
        }
      });
    });
  }, [contentRef, onboardingVisible, panelView, syncScrollThumb]);

  return () => {
    revealScrollThumb();
    if (!loaded.current) return;
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveSidepanelState({
        expandedFolderIds: [...expanded],
        scrollTop: contentRef.current?.scrollTop || 0,
      });
    }, 180);
  };
}

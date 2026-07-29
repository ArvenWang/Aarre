import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSidepanelState,
  saveSidepanelState
} from "../src/lib/sidepanel-state";
import {
  completeOnboarding,
  getOnboardingState
} from "../src/lib/onboarding";

let values: Record<string, unknown>;

beforeEach(() => {
  values = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: values[key] };
        },
        async set(next: Record<string, unknown>) {
          Object.assign(values, next);
        },
        async remove(key: string) {
          delete values[key];
        }
      }
    }
  });
});

describe("persistent UI state", () => {
  it("deduplicates expanded folders and clamps scroll state", async () => {
    await saveSidepanelState({
      expandedFolderIds: ["one", "one", "two"],
      scrollTop: -12
    });
    expect(await getSidepanelState()).toEqual({
      expandedFolderIds: ["one", "two"],
      scrollTop: 0
    });
  });

  it("records an explicit onboarding skip without showing it again", async () => {
    expect((await getOnboardingState()).completed).toBe(false);
    await completeOnboarding(true);
    expect(await getOnboardingState()).toMatchObject({
      completed: true,
      skipped: true
    });
  });
});

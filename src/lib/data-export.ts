import {
  getAiEntitlement,
  getAiGatewayUsage
} from "./ai-gateway";
import { getAgentConversations } from "./conversations";
import { getDisplaySettings } from "./display-settings";
import { getOnboardingState } from "./onboarding";
import { getAiSettingsStatus } from "./settings";
import { getSidepanelState } from "./sidepanel-state";
import {
  getLocalResources,
  getOutbox,
  getPageSnapshots,
  getSiteBrands,
  getUndoSnapshots
} from "./storage";
import { getAiUsageStats } from "./usage-stats";

const LIBRARY_SCAN_KEY = "aarre:library-scan";

async function getLocalScanState(): Promise<unknown> {
  return (await chrome.storage.local.get(LIBRARY_SCAN_KEY))[
    LIBRARY_SCAN_KEY
  ];
}

export interface AarreDataExport {
  format: "aarre-data-export";
  schemaVersion: 1;
  exportedAt: string;
  appVersion: string;
  privacy: {
    includesApiKeys: false;
    includesCloudTokens: false;
    includesLocalPageSnapshots: true;
  };
  settings: {
    ai: Omit<
      Awaited<ReturnType<typeof getAiSettingsStatus>>,
      "apiKeySuffix"
    >;
    entitlement: Awaited<ReturnType<typeof getAiEntitlement>>;
    gatewayUsage: Awaited<ReturnType<typeof getAiGatewayUsage>>;
    display: Awaited<ReturnType<typeof getDisplaySettings>>;
    usage: Awaited<ReturnType<typeof getAiUsageStats>>;
    onboarding: Awaited<ReturnType<typeof getOnboardingState>>;
    sidepanel: Awaited<ReturnType<typeof getSidepanelState>>;
  };
  data: {
    resources: Awaited<ReturnType<typeof getLocalResources>>;
    outbox: Awaited<ReturnType<typeof getOutbox>>;
    siteBrands: Awaited<ReturnType<typeof getSiteBrands>>;
    pageSnapshots: Awaited<ReturnType<typeof getPageSnapshots>>;
    undoSnapshots: Awaited<ReturnType<typeof getUndoSnapshots>>;
    conversations: Awaited<ReturnType<typeof getAgentConversations>>;
    libraryScan: Awaited<ReturnType<typeof getLocalScanState>>;
  };
}

export async function createAarreDataExport(): Promise<AarreDataExport> {
  const [
    ai,
    entitlement,
    gatewayUsage,
    display,
    usage,
    onboarding,
    sidepanel,
    resources,
    outbox,
    siteBrands,
    pageSnapshots,
    undoSnapshots,
    conversations,
    libraryScan
  ] = await Promise.all([
    getAiSettingsStatus(),
    getAiEntitlement(),
    getAiGatewayUsage(),
    getDisplaySettings(),
    getAiUsageStats(),
    getOnboardingState(),
    getSidepanelState(),
    getLocalResources(),
    getOutbox(),
    getSiteBrands(),
    getPageSnapshots(),
    getUndoSnapshots(),
    getAgentConversations(),
    getLocalScanState()
  ]);
  const { apiKeySuffix: _apiKeySuffix, ...safeAiSettings } = ai;
  return {
    format: "aarre-data-export",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: chrome.runtime.getManifest().version,
    privacy: {
      includesApiKeys: false,
      includesCloudTokens: false,
      includesLocalPageSnapshots: true
    },
    settings: {
      ai: safeAiSettings,
      entitlement,
      gatewayUsage,
      display,
      usage,
      onboarding,
      sidepanel
    },
    data: {
      resources,
      outbox,
      siteBrands,
      pageSnapshots,
      undoSnapshots,
      conversations,
      libraryScan
    }
  };
}

export async function downloadAarreDataExport(): Promise<{
  filename: string;
  bytes: number;
}> {
  const bundle = await createAarreDataExport();
  const content = `${JSON.stringify(bundle, null, 2)}\n`;
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const filename = `aarre-export-${bundle.exportedAt.slice(0, 10)}.json`;
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
  return { filename, bytes: blob.size };
}

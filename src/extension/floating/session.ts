import { getFloatingSettings, saveFloatingSettings } from "../../lib/floating-settings";
import { getOnboardingState } from "../../lib/onboarding";
import { isSupportedPageUrl } from "../../lib/url";
import type { ActiveTabSummary } from "../../lib/types";

interface HostSession { tabId: number; documentId: string; nonce: string; frameId?: number; frameDocumentId?: string }
const key = (tabId: number) => `aarre:floating-session:${tabId}`;
const origin = () => chrome.runtime.getURL("").replace(/\/$/, "");
const error = () => new Error("此菜单已失效，请从当前网页重新打开 Aarre。");
async function readSession(tabId: number): Promise<HostSession | undefined> {
  return (await chrome.storage.session.get(key(tabId)))[key(tabId)] as HostSession | undefined;
}

interface FrameProof { sender: chrome.runtime.MessageSender; nonce: string; resolve(): void }
const frameProofs = new Map<string, FrameProof>();

// The top-page host delivers this challenge only to the iframe it owns. Its
// reply arrives over runtime messaging, so the page cannot claim a document ID.
export function proveFloatingFrame(request: { challenge?: unknown; nonce?: unknown }, sender: chrome.runtime.MessageSender): void {
  const proof = typeof request.challenge === "string" ? frameProofs.get(request.challenge) : undefined;
  if (!proof || request.nonce !== proof.nonce || sender.id !== chrome.runtime.id ||
      sender.tab?.id !== proof.sender.tab?.id || sender.frameId !== proof.sender.frameId ||
      sender.documentId !== proof.sender.documentId || sender.url !== proof.sender.url) throw error();
  proof.resolve();
}

async function verifyOwnedFrame(session: HostSession, sender: chrome.runtime.MessageSender): Promise<void> {
  const challenge = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout>;
  const proof = new Promise<void>((resolve) => {
    frameProofs.set(challenge, { sender: { ...sender }, nonce: session.nonce, resolve });
  });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("菜单连接超时，请重新打开。")), 5_000);
  });
  try {
    await Promise.race([deadline, Promise.all([proof, Promise.resolve().then(async () => {
      const response = await chrome.tabs.sendMessage(session.tabId, {
        type: "FLOAT_VERIFY_FRAME", challenge, session: session.nonce,
      }, { documentId: session.documentId, frameId: 0 });
      if (!response?.ok) throw error();
    })])]);
  } finally {
    clearTimeout(timer!);
    frameProofs.delete(challenge);
  }
}

export async function validateFloatingSender(sender: chrome.runtime.MessageSender, nonce?: string): Promise<HostSession> {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.documentId || !sender.frameId) throw error();
  const session = await readSession(sender.tab.id);
  if (!session || (nonce !== undefined && nonce !== session.nonce)) throw error();
  const [parent, contexts] = await Promise.all([
    chrome.webNavigation.getFrame({ tabId: session.tabId, frameId: 0 }),
    // webNavigation omits extension-origin frames in real Chrome. runtime is
    // the authoritative inventory of our extension's active documents.
    chrome.runtime.getContexts({ contextTypes: ["TAB"], tabIds: [session.tabId], documentIds: [sender.documentId] }),
  ]);
  if (!parent || parent.documentId !== session.documentId) throw error();
  const frame = contexts.find((item) => item.frameId === sender.frameId && item.documentId === sender.documentId &&
    item.tabId === session.tabId && item.documentOrigin === origin() && item.documentUrl === sender.url);
  if (!frame || !sender.url?.startsWith(`${origin()}/floating.html?`)) throw error();
  const params = new URL(sender.url).searchParams;
  if (params.get("session") !== session.nonce || Number(params.get("tab")) !== session.tabId) throw error();
  if (session.frameDocumentId && (session.frameId !== sender.frameId || (!nonce && session.frameDocumentId !== sender.documentId))) throw error();
  if (!session.frameDocumentId || session.frameDocumentId !== sender.documentId) {
    if (!nonce) throw error();
    await verifyOwnedFrame(session, sender);
    const [current, currentParent] = await Promise.all([
      readSession(session.tabId), chrome.webNavigation.getFrame({ tabId: session.tabId, frameId: 0 }),
    ]);
    if (!current || current.nonce !== session.nonce || current.documentId !== session.documentId ||
        currentParent?.documentId !== session.documentId ||
        (current.frameId !== undefined && current.frameId !== sender.frameId)) throw error();
    session.frameDocumentId = sender.documentId;
    session.frameId = sender.frameId;
    await chrome.storage.session.set({ [key(session.tabId)]: session });
  }
  return session;
}
export async function floatingSource(sender: chrome.runtime.MessageSender): Promise<ActiveTabSummary | null> {
  if (!sender.url?.startsWith(`${origin()}/floating.html`)) return null;
  const session = await validateFloatingSender(sender);
  const tab = await chrome.tabs.get(session.tabId);
  return { id: tab.id, url: tab.url || "", title: tab.title || "", faviconUrl: tab.favIconUrl || "", supported: isSupportedPageUrl(tab.url || "") };
}
export async function authorizeUiMessage(sender: chrome.runtime.MessageSender): Promise<ActiveTabSummary | null> {
  // Only our extension pages may invoke privileged business operations. The host has a separate narrow protocol.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(`${origin()}/`)) throw error();
  return floatingSource(sender);
}
export async function handleFloatingHost(request: Record<string, any>, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !sender.documentId || !isSupportedPageUrl(sender.url || "")) throw error();
  const tabId = sender.tab.id;
  const parent = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
  if (!parent || parent.documentId !== sender.documentId) throw error();
  if (request.type === "FLOAT_HOST_INIT") {
    const [settings, onboarding, theme] = await Promise.all([getFloatingSettings(), getOnboardingState(), chrome.storage.local.get("aarre:theme-sync:v1")]);
    let session = await readSession(tabId);
    if (!session || session.documentId !== sender.documentId || request.freshHost === true) {
      session = { tabId, documentId: sender.documentId, nonce: crypto.randomUUID() };
      await chrome.storage.session.set({ [key(tabId)]: session });
    }
    return { ...session, enabled: onboarding.completed && settings.enabled && !settings.hiddenHosts.includes(new URL(sender.url!).hostname), position: settings.position, theme: theme["aarre:theme-sync:v1"] };
  }
  if (request.type === "FLOAT_POSITION") {
    const settings = await getFloatingSettings();
    await saveFloatingSettings({ ...settings, position: request.position });
    return { saved: true };
  }
  throw error();
}

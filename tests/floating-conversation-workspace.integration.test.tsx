// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidePanelApp } from "../src/ui/sidepanel/SidePanelApp";
import { installSidePanelPreview } from "../src/ui/sidepanel/preview";
import { previewMutable } from "../src/ui/sidepanel/preview-state";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no scrolling layout; real scroll containment is checked in Ego.
HTMLElement.prototype.scrollIntoView = vi.fn();
let root: Root;
let container: HTMLDivElement;
let requests: Record<string, unknown>[];
let answer: ((result: unknown) => void) | undefined;

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal("chrome", {});
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem("aarre:onboarding-done", "1");
  previewMutable.conversations = [];
  previewMutable.aiSettings.apiKeyConfigured = false;
  installSidePanelPreview();
  const runtime = chrome.runtime as unknown as { sendMessage: (request: Record<string, unknown>) => Promise<unknown> };
  const original = runtime.sendMessage.bind(runtime);
  requests = []; answer = undefined;
  runtime.sendMessage = async (request) => {
    requests.push(request);
    // Only the external service is controlled. Real preview persistence and
    // actual app, composer, chat hook, HeroUI menus and dialogs remain mounted.
    if (request.type === "ASK_BOOKMARK_AGENT") return new Promise(resolve => { answer = resolve; });
    if (request.type === "CANCEL_BOOKMARK_AGENT") return { ok: true, data: { cancelled: true } };
    return original(request);
  };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear(); sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => { root.render(<SidePanelApp surface="floating" />); });
}
async function waitFor(predicate: () => boolean) {
  await vi.waitFor(async () => { await act(async () => {}); expect(predicate()).toBe(true); }, { timeout: 5000 });
}
const composer = () => document.querySelector<HTMLTextAreaElement>("#bookmark-agent-prompt")!;
async function fill(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer(), text);
    composer().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(selector: string) {
  const button = document.querySelector<HTMLElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
}
async function submit() { await click('button[aria-label="发送给 Aarre"]'); }

it("keeps one usable composer and its draft when an unconfigured question opens and closes settings", async () => {
  await mount();
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
  expect(document.querySelectorAll('form[aria-label="与 Aarre 对话"]')).toHaveLength(1);
  const original = composer();
  await fill("找找我收藏里的设计资料"); await submit();
  await waitFor(() => Boolean(document.querySelector('[role="dialog"] .settings-field')));
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(composer()).toBe(original);
  expect(composer().value).toBe("找找我收藏里的设计资料");
  expect(requests.some(request => request.type === "ASK_BOOKMARK_AGENT")).toBe(false);
  await click('button[aria-label="关闭窗口"]');
  await waitFor(() => !document.querySelector('[role="dialog"]'));
  expect(composer()).toBe(original);
  expect(composer().value).toBe("找找我收藏里的设计资料");
});

it("sends directly from the library, preserves the composer while answering, and resumes the same conversation", async () => {
  previewMutable.aiSettings.apiKeyConfigured = true;
  await mount();
  const original = composer();
  await fill("查找设计资料"); await submit();
  await waitFor(() => Boolean(answer));
  expect(composer()).toBe(original);
  expect(document.querySelector('button[aria-label="停止 AI 对话"]')).not.toBeNull();
  await act(async () => { answer!({ ok: true, data: { answer: "这是来自测试传输的回答。", sources: [], actions: [] } }); });
  await waitFor(() => Boolean(document.querySelector(".agent-markdown")));
  expect(composer()).toBe(original);
  expect(composer().disabled).toBe(false);
  expect(previewMutable.conversations[0]?.messages).toHaveLength(2);
  await fill("继续帮我整理");
  await click('button[aria-label="返回收藏列表"]');
  expect(composer().value).toBe("继续帮我整理");
  await click('.agent-composer-context button');
  expect(composer()).toBe(original);
  expect(document.querySelector(".agent-markdown")?.textContent).toContain("测试传输");
  await submit();
  await waitFor(() => requests.filter(request => request.type === "ASK_BOOKMARK_AGENT").length === 2);
  const followUp = requests.filter(request => request.type === "ASK_BOOKMARK_AGENT")[1];
  expect(followUp.history).toHaveLength(2);
  await act(async () => { answer!({ ok: true, data: { answer: "继续整理完成。", sources: [], actions: [] } }); });
});

it("stops a direct question and does not replace its cancelled state with a late answer", async () => {
  previewMutable.aiSettings.apiKeyConfigured = true;
  await mount();
  await fill("整理设计收藏"); await submit();
  await waitFor(() => Boolean(answer));
  await click('button[aria-label="停止 AI 对话"]');
  expect(requests.some(request => request.type === "CANCEL_BOOKMARK_AGENT")).toBe(true);
  expect(composer().disabled).toBe(false);
  await act(async () => { answer!({ ok: true, data: { answer: "迟到的回答", sources: [], actions: [] } }); });
  expect(previewMutable.conversations[0]?.messages.at(-1)?.status).toBe("cancelled");
  expect(document.body.textContent).not.toContain("迟到的回答");
});

it("renders streamed text before completion and releases the same composer when done", async () => {
  previewMutable.aiSettings.apiKeyConfigured = true;
  const listeners = new Set<(event: unknown) => void>();
  const port = {
    onMessage: { addListener: (fn: (event: unknown) => void) => listeners.add(fn), removeListener: (fn: (event: unknown) => void) => listeners.delete(fn) },
    onDisconnect: { addListener() {}, removeListener() {} },
    postMessage: vi.fn(), disconnect: vi.fn(),
  };
  chrome.runtime.connect = (() => port) as unknown as typeof chrome.runtime.connect;
  await mount();
  const original = composer();
  await fill("逐步整理设计资料"); await submit();
  await waitFor(() => port.postMessage.mock.calls.length === 1);
  await act(async () => { for (const listener of listeners) listener({ type: "delta", text: "第一段已返回。" }); });
  await waitFor(() => Boolean(document.querySelector(".agent-markdown")?.textContent?.includes("第一段已返回")));
  expect(document.querySelector('button[aria-label="停止 AI 对话"]')).not.toBeNull();
  expect(composer()).toBe(original);
  await act(async () => { for (const listener of listeners) listener({ type: "done", response: { answer: "第一段已返回。", sources: [], actions: [] } }); });
  expect(composer().disabled).toBe(false);
  expect(composer()).toBe(original);
  expect(listeners.size).toBe(0);
  expect(port.disconnect).toHaveBeenCalledOnce();
});

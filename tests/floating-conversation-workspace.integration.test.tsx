// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidePanelApp } from "../src/ui/sidepanel/SidePanelApp";
import { installSidePanelPreview } from "../src/ui/sidepanel/preview";
import { requestFloatingSave, acceptFloatingSave, getFloatingSaveRequest, setFloatingContext } from "../src/ui/floating/bridge";
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
  const pending = getFloatingSaveRequest(); if (pending) acceptFloatingSave(pending);
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

async function editField(selector: string, text: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(field).not.toBeNull();
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("opens a cold star request as a full save form, keeps repeated intent drafts, and cancels without a write", async () => {
  setFloatingContext({ tabId: 1, nonce: "ui-close-test", parentOrigin: location.origin,
    source: { id: 1, url: "https://example.com/design-review", title: "Test", faviconUrl: "", supported: true } });
  const committed: boolean[] = [];
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(message => {
    if (message.type === "FLOAT_SAVE_ACCEPTED") committed.push(Boolean(document.querySelector(".floating-save-page")));
  });
  const id = crypto.randomUUID(); requestFloatingSave(id);
  await mount();
  await waitFor(() => Boolean(document.querySelector('.floating-save-page .save-source')));
  expect(document.querySelector('#native-dialog-title')?.textContent).toBe("添加到收藏");
  expect(document.querySelector('.save-source a')?.getAttribute('href')).toBe("https://example.com/design-review");
  await editField('.floating-save-page input', '保留这个收藏草稿');
  await editField('.floating-save-page textarea', '稍后再保存的备注');
  await act(async () => { requestFloatingSave(id); requestFloatingSave(crypto.randomUUID()); });
  expect(document.querySelectorAll('.floating-save-page')).toHaveLength(1);
  expect(document.querySelector<HTMLInputElement>('.floating-save-page input')?.value).toBe('保留这个收藏草稿');
  expect(document.querySelector<HTMLTextAreaElement>('.floating-save-page textarea')?.value).toBe('稍后再保存的备注');
  expect(committed.length).toBeGreaterThan(0); expect(committed.every(Boolean)).toBe(true);
  expect(document.querySelector('button[aria-label="返回菜单"]')).toBeNull();
  await click('button[aria-label="关闭"]');
  await waitFor(() => !document.querySelector('.floating-save-page'));
  expect(post).toHaveBeenCalledWith({ type: "FLOAT_CLOSE", resetSave: true, session: "ui-close-test" }, location.origin);
  post.mockRestore();
  expect(requests.some(request => request.type === 'SAVE_BOOKMARK')).toBe(false);
});

it("dismisses the portaled folder picker with Escape while retaining the save form and its draft", async () => {
  await mount();
  await act(async () => requestFloatingSave("folder-picker-escape"));
  await waitFor(() => Boolean(document.querySelector('.floating-save-page textarea')));
  await editField('.floating-save-page textarea', '选文件夹时保留这条备注');
  await click('.folder-select-trigger');
  await waitFor(() => Boolean(document.querySelector('.aarre-folder-popover')));
  const option=document.querySelector<HTMLElement>('.folder-select-option[data-active="true"]')!;
  await act(async () => { option.focus(); option.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); });
  await waitFor(() => !document.querySelector('.aarre-folder-popover'));
  expect(document.querySelector<HTMLTextAreaElement>('.floating-save-page textarea')?.value).toBe('选文件夹时保留这条备注');
  expect(requests.some(request => request.type === 'SAVE_BOOKMARK')).toBe(false);
});

it("reads an existing bookmark's fresh note and folder before showing a cold save form", async () => {
  const runtime = chrome.runtime as unknown as { sendMessage: (request: Record<string, unknown>) => Promise<unknown> };
  const original = runtime.sendMessage;
  runtime.sendMessage = async request => {
    if (request.type === 'GET_BOOKMARK_SAVE_STATE') return { ok: true, data: {status:'exact', matches:[{id:'existing',parentId:'preview-folder-1',title:'已有的自定义名称',url:'https://example.com/design-review',path:['书签栏','前端代码']}]}};
    if (request.type === 'GET_LOCAL_RESOURCES') return {ok:true,data:[{resourceKey:'existing',url:'https://example.com/design-review',canonicalUrl:'https://example.com/design-review',userNote:'已有备注不能丢失',nativeBookmarkIds:['existing']}]};
    return original(request);
  };
  requestFloatingSave(crypto.randomUUID()); await mount();
  await waitFor(() => Boolean(document.querySelector('.floating-save-page textarea')));
  expect(document.querySelector('#native-dialog-title')?.textContent).toBe('管理此收藏');
  expect(document.querySelector<HTMLInputElement>('.floating-save-page input')?.value).toBe('已有的自定义名称');
  expect(document.querySelector<HTMLTextAreaElement>('.floating-save-page textarea')?.value).toBe('已有备注不能丢失');
  expect(document.querySelector('.folder-select')?.textContent || document.querySelector('.floating-save-page')?.textContent).toContain('前端代码');
  expect(document.querySelector('.save-state-note')?.textContent).toContain('不会创建重复收藏');
  expect(requests.some(request => request.type === 'SAVE_BOOKMARK')).toBe(false);
});

it("writes the reviewed title, folder and note only after the save button is confirmed", async () => {
  const runtime = chrome.runtime as unknown as { sendMessage: (request: Record<string, unknown>) => Promise<unknown> };
  const original = runtime.sendMessage;
  let saved: Record<string, unknown> | undefined;
  runtime.sendMessage = async request => {
    if (request.type === 'SAVE_BOOKMARK') { saved = request; return {ok:true,data:{resource:null,nativeBookmarkCreated:true,cloudSynced:false}}; }
    return original(request);
  };
  await mount();
  await act(async () => requestFloatingSave(crypto.randomUUID()));
  await waitFor(() => Boolean(document.querySelector('.floating-save-page textarea')));
  await editField('.floating-save-page input', '经过确认的名称');
  await editField('.floating-save-page textarea', '经过确认的备注');
  expect(saved).toBeUndefined();
  const saveButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.native-dialog-actions button')).find(button => button.textContent === '添加到 Chrome')!;
  expect(saveButton.disabled).toBe(false);
  await act(async () => saveButton.click());
  await waitFor(() => Boolean(saved));
  expect(saved?.payload).toMatchObject({ title:'经过确认的名称', userNote:'经过确认的备注', sourceTabId:1 });
  expect((saved?.payload as Record<string,unknown>).folderId).toEqual(expect.any(String));
  await waitFor(() => !document.querySelector('.floating-save-page'));
});

it("shows a failed save inside the page and retries with the same reviewed fields", async () => {
  const runtime = chrome.runtime as unknown as { sendMessage: (request: Record<string, unknown>) => Promise<unknown> };
  const original = runtime.sendMessage;
  const attempts: unknown[] = [];
  runtime.sendMessage = async request => {
    if (request.type === 'SAVE_BOOKMARK') {
      attempts.push(request.payload);
      return attempts.length === 1 ? {ok:false,error:'当前无法保存，请重试。'} : {ok:true,data:{resource:null,nativeBookmarkCreated:true,cloudSynced:false}};
    }
    return original(request);
  };
  await mount(); await act(async () => requestFloatingSave(crypto.randomUUID()));
  await waitFor(() => Boolean(document.querySelector('.floating-save-page textarea')));
  await editField('.floating-save-page textarea', '失败重试也要保留');
  const save = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.native-dialog-actions button')).find(button => button.textContent === '添加到 Chrome')!;
  await act(async () => save().click());
  await waitFor(() => Boolean(document.querySelector('.floating-save-page [role="alert"]')));
  expect(document.querySelector('.floating-save-page [role="alert"]')?.textContent).toBe('当前无法保存，请重试。');
  expect(document.querySelector<HTMLTextAreaElement>('.floating-save-page textarea')?.value).toBe('失败重试也要保留');
  await act(async () => save().click());
  await waitFor(() => !document.querySelector('.floating-save-page'));
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
});

it('starts AI on opening the save form, stays editable while pending, and carries the same preparation into save', async () => {
  const runtime = chrome.runtime as unknown as { sendMessage: (request: Record<string, unknown>) => Promise<unknown> };
  const original=runtime.sendMessage; let analysis:Record<string,any>|undefined; let saved:Record<string,any>|undefined;
  let resolve!:(value:unknown)=>void;
  runtime.sendMessage=async request=>{
    if(request.type==='PREPARE_BOOKMARK_AI'){analysis=request;return new Promise(r=>{resolve=r;});}
    if(request.type==='SAVE_BOOKMARK'){saved=request;return {ok:true,data:{enhancementPending:true}};}
    return original(request);
  };
  await mount();await act(async()=>requestFloatingSave(crypto.randomUUID()));
  await waitFor(()=>Boolean(analysis));
  expect(document.querySelector('.save-ai-preview')?.textContent).toContain('正在 AI 增强');
  expect(saved).toBeUndefined();
  await editField('.floating-save-page textarea','AI 期间填写的备注');
  const save=Array.from(document.querySelectorAll<HTMLButtonElement>('.native-dialog-actions button')).find(b=>b.textContent==='添加到 Chrome')!;
  expect(save.disabled).toBe(false);await act(async()=>save.click());await waitFor(()=>Boolean(saved));
  expect(saved?.payload).toMatchObject({userNote:'AI 期间填写的备注',aiPreparationId:analysis?.payload.requestId});
  await waitFor(()=>!document.querySelector('.floating-save-page'));
  await act(async()=>resolve({ok:true,data:{status:'ready',summary:'旧表单的结果',tags:['旧结果']}}));
  expect(document.body.textContent).not.toContain('旧表单的结果');
});

it('shows completed AI without changing the reviewed fields and ignores results from a closed form', async()=>{
  const runtime=chrome.runtime as unknown as {sendMessage:(request:Record<string,unknown>)=>Promise<unknown>};
  const original=runtime.sendMessage;const answers:Array<(value:unknown)=>void>=[];
  runtime.sendMessage=async request=>request.type==='PREPARE_BOOKMARK_AI'?new Promise(r=>answers.push(r)):original(request);
  await mount();await act(async()=>requestFloatingSave(crypto.randomUUID()));await waitFor(()=>answers.length===1);
  await click('button[aria-label="关闭"]');await waitFor(()=>!document.querySelector('.floating-save-page'));
  await act(async()=>requestFloatingSave(crypto.randomUUID()));await waitFor(()=>answers.length===2);
  await editField('.floating-save-page input','新表单名称');await editField('.floating-save-page textarea','新表单备注');
  await act(async()=>answers[0]({ok:true,data:{status:'ready',summary:'不应混入的旧摘要',tags:['旧标签']}}));
  expect(document.body.textContent).not.toContain('不应混入的旧摘要');
  await act(async()=>answers[1]({ok:true,data:{status:'ready',summary:'当前页面的摘要',tags:['新标签']}}));
  expect(document.querySelector('.save-ai-preview')?.textContent).toContain('当前页面的摘要');
  expect(document.querySelector<HTMLInputElement>('.floating-save-page input')?.value).toBe('新表单名称');
  expect(document.querySelector<HTMLTextAreaElement>('.floating-save-page textarea')?.value).toBe('新表单备注');
});

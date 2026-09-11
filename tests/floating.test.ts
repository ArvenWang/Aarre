import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { floatingRects, defaultFloatingPosition, floatingPositionAt } from "../src/lib/floating-geometry";
import { handleFloatingHost, authorizeUiMessage, validateFloatingSender, proveFloatingFrame } from "../src/extension/floating/session";
import { withFloatingHidden } from "../src/extension/floating/lifecycle";
const local: Record<string,any> = {}, session: Record<string,any> = {};
const parent = { frameId: 0, documentId: "parent-a" };
let contexts: any[] = [];
let ownedFrame: chrome.runtime.MessageSender;
let proofHook: (() => void) | undefined;
function storage(values: Record<string, any>) { return { get: async (key: string) => ({ [key]: values[key] }), set: async (input: any) => { Object.assign(values, structuredClone(input)); }, remove: async (key: string) => { delete values[key]; } }; }
beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key]; for (const key of Object.keys(session)) delete session[key];
  parent.documentId="parent-a"; contexts=[]; proofHook=undefined;
  vi.stubGlobal("chrome", { runtime: { id: "aarre", getURL: (path: string) => `chrome-extension://aarre/${path}`, getContexts: vi.fn(async () => contexts) },
    // Reproduce installed Chrome: webNavigation contains only ordinary web
    // frames. Our extension iframe is discoverable only through runtime.
    storage: { local: storage(local), session: storage(session) }, webNavigation: { getFrame: async ({frameId}: any) => frameId === 0 ? parent : null, getAllFrames: vi.fn(async () => [parent]) },
    tabs: { get: async (id: number) => ({ id, url: "https://source.example/page", title: "source" }), sendMessage: vi.fn(async (_tab, msg) => {
      if (msg.type === "FLOAT_VERIFY_FRAME") {
        proofHook?.();
        try { proveFloatingFrame({ challenge: msg.challenge, nonce: msg.session }, ownedFrame); } catch { /* A different frame cannot answer for the candidate. */ }
      }
      return { ok: true, lease: msg.lease };
    }) },
    scripting: { executeScript: vi.fn(async () => [{ result: true }]) } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("floating geometry", () => {
  for (const [width,height] of [[360,640],[420,800],[1280,720],[1440,900]]) for (const edge of ["left","right"] as const) for (const ratio of [0,1]) {
    it(`${width}×${height} ${edge} ${ratio} stays in viewport with a 52px ball`, () => {
      const result=floatingRects({...defaultFloatingPosition,edge,ratio},{width,height});
      for(const rect of Object.values(result)) { expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);expect(rect.y+rect.height).toBeLessThanOrEqual(height); }
      expect(result.ball.width).toBe(52);expect(result.ball.height).toBe(52);
    });
  }
  it("restores a dragged point after zoom or viewport resizing", () => {
    const position=floatingPositionAt(0,500,{width:1440,height:900},defaultFloatingPosition);
    const result=floatingRects(position,{width:420,height:640,left:30,top:20});
    expect(result.ball.x).toBe(42);expect(position.ratio).toBeGreaterThan(0.5);expect(result.menu.x+result.menu.width).toBeLessThanOrEqual(450);
  });
});
describe("floating source identity", () => {
  async function prepare() {
    const host = { id:"aarre", frameId:0, documentId:"parent-a", tab:{id:7}, url:"https://source.example/page" } as chrome.runtime.MessageSender;
    const result=await handleFloatingHost({type:"FLOAT_HOST_INIT"},host) as any;
    const sender={id:"aarre",frameId:4,documentId:"child-a",tab:{id:7},url:`chrome-extension://aarre/floating.html?tab=7&session=${result.nonce}`} as chrome.runtime.MessageSender;
    contexts=[{contextType:"TAB",tabId:7,frameId:4,documentId:"child-a",documentUrl:sender.url,documentOrigin:"chrome-extension://aarre"}];
    ownedFrame=sender;
    return {sender,result};
  }
  async function connect() {
    const prepared=await prepare();
    await validateFloatingSender(prepared.sender,prepared.result.nonce); return prepared;
  }
  it("keeps the menu bound to its source, regardless of the active tab", async () => { const {sender}=await connect();expect((await authorizeUiMessage(sender))?.id).toBe(7); });
  it("rejects web pages invoking privileged messages",async()=>{await expect(authorizeUiMessage({id:"aarre",url:"https://source.example/page"})).rejects.toThrow();});
  it("connects when webNavigation omits the extension iframe and scopes the proof to the current host document",async()=>{
    const {sender}=await connect();
    expect(session["aarre:floating-session:7"].frameDocumentId).toBe("child-a");
    expect(chrome.runtime.getContexts).toHaveBeenCalledWith({contextTypes:["TAB"],tabIds:[7],documentIds:[sender.documentId]});
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7,expect.objectContaining({type:"FLOAT_VERIFY_FRAME"}),{documentId:"parent-a",frameId:0});
  });
  it("rejects a forged nonce and an inactive extension document",async()=>{const {sender}=await connect();await expect(validateFloatingSender(sender,"wrong")).rejects.toThrow();contexts=[];await expect(validateFloatingSender(sender)).rejects.toThrow();});
  it("does not authorize business operations before the initial handshake",async()=>{const {sender}=await prepare();await expect(authorizeUiMessage(sender)).rejects.toThrow();expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();});
  it("rejects a nested or copied iframe even with the same URL and nonce",async()=>{
    vi.useFakeTimers();
    const {sender,result}=await prepare();
    const nested={...sender,frameId:8,documentId:"nested"};
    contexts.push({...contexts[0],frameId:8,documentId:"nested"});
    const attempt=expect(validateFloatingSender(nested,result.nonce)).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(5_000); await attempt;
    expect(session["aarre:floating-session:7"].frameDocumentId).toBeUndefined();
  });
  it("bounds an unresponsive host and expires its proof challenge",async()=>{
    vi.useFakeTimers();const {sender,result}=await prepare();
    vi.mocked(chrome.tabs.sendMessage).mockImplementation((() => new Promise(() => {})) as any);
    const attempt=expect(validateFloatingSender(sender,result.nonce)).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(5_000);await attempt;
    const message=vi.mocked(chrome.tabs.sendMessage).mock.calls[0][1] as any;
    expect(()=>proveFloatingFrame({challenge:message.challenge,nonce:result.nonce},sender)).toThrow();
  });
  it("rejects host rejection and leaves the document unbound",async()=>{
    const {sender,result}=await prepare();(vi.mocked(chrome.tabs.sendMessage) as any).mockResolvedValue({ok:false});
    await expect(validateFloatingSender(sender,result.nonce)).rejects.toThrow();
    expect(session["aarre:floating-session:7"].frameDocumentId).toBeUndefined();
  });
  it("still times out if the frame proves its identity but the host acknowledgement never arrives",async()=>{
    vi.useFakeTimers();const {sender,result}=await prepare();
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(((_tab: number,msg: any) => {
      proveFloatingFrame({challenge:msg.challenge,nonce:msg.session},sender);
      return new Promise(() => {});
    }) as any);
    const attempt=expect(validateFloatingSender(sender,result.nonce)).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(5_000);await attempt;
    expect(session["aarre:floating-session:7"].frameDocumentId).toBeUndefined();
  });
  it.each(["session","navigation"])("does not commit an identity after %s changes during proof",async(change)=>{
    const {sender,result}=await prepare();proofHook=()=>{if(change==="session") session["aarre:floating-session:7"]={...result,nonce:"new-host"};else parent.documentId="parent-b";};
    await expect(validateFloatingSender(sender,result.nonce)).rejects.toThrow();
    expect(session["aarre:floating-session:7"].frameDocumentId).toBeUndefined();
  });
  it("rejects an old menu after parent navigation",async()=>{const {sender}=await connect();parent.documentId="parent-b";await expect(authorizeUiMessage(sender)).rejects.toThrow();});
  it("requires a new handshake after a child reload and rejects a replacement frame",async()=>{
    const {sender,result}=await connect();const oldSender={...sender};contexts[0].documentId="child-b";sender.documentId="child-b";
    await expect(authorizeUiMessage(sender)).rejects.toThrow();await validateFloatingSender(sender,result.nonce);expect((await authorizeUiMessage(sender))?.id).toBe(7);
    await expect(authorizeUiMessage(oldSender)).rejects.toThrow();
    contexts[0].frameId=5;sender.frameId=5;await expect(validateFloatingSender(sender,result.nonce)).rejects.toThrow();
  });
});
describe("capture leases",()=>{
  it("acknowledges hiding before capture, and always restores after failure",async()=>{
    const capture=vi.fn(async()=>{expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7,expect.objectContaining({hidden:true}),{frameId:0});throw new Error("capture failed");});
    await expect(withFloatingHidden(7,capture)).rejects.toThrow("capture failed");
    const calls=vi.mocked(chrome.tabs.sendMessage).mock.calls as any[];expect(calls[0][1].lease).toBe(calls[1][1].lease);expect(calls[1][1].hidden).toBe(false);
  });
  it("fails closed if a visible host does not acknowledge",async()=>{(vi.mocked(chrome.tabs.sendMessage) as any).mockResolvedValue({ok:false});const capture=vi.fn();await expect(withFloatingHidden(7,capture)).rejects.toThrow();expect(capture).not.toHaveBeenCalled();});
  it("captures pages without a floating host",async()=>{(vi.mocked(chrome.scripting.executeScript) as any).mockResolvedValue([{result:false} as any]);expect(await withFloatingHidden(7,async()=>"image")).toBe("image");expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();});
});

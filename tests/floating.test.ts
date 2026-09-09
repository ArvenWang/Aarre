import { beforeEach, describe, expect, it, vi } from "vitest";
import { floatingRects, defaultFloatingPosition, floatingPositionAt } from "../src/lib/floating-geometry";
import { handleFloatingHost, authorizeUiMessage, validateFloatingSender } from "../src/extension/floating/session";
import { withFloatingHidden } from "../src/extension/floating/lifecycle";
const local: Record<string,any> = {}, session: Record<string,any> = {};
const parent = { frameId: 0, documentId: "parent-a" };
let frames: any[] = [];
function storage(values: Record<string, any>) { return { get: async (key: string) => ({ [key]: values[key] }), set: async (input: any) => { Object.assign(values, structuredClone(input)); }, remove: async (key: string) => { delete values[key]; } }; }
beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key]; for (const key of Object.keys(session)) delete session[key];
  parent.documentId="parent-a"; frames=[];
  vi.stubGlobal("chrome", { runtime: { id: "aarre", getURL: (path: string) => `chrome-extension://aarre/${path}` },
    storage: { local: storage(local), session: storage(session) }, webNavigation: { getFrame: async () => parent, getAllFrames: async () => frames },
    tabs: { get: async (id: number) => ({ id, url: "https://source.example/page", title: "source" }), sendMessage: vi.fn(async (_tab, msg) => ({ ok: true, lease: msg.lease })) },
    scripting: { executeScript: vi.fn(async () => [{ result: true }]) } });
});
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
  async function connect() {
    const host = { id:"aarre", frameId:0, documentId:"parent-a", tab:{id:7}, url:"https://source.example/page" } as chrome.runtime.MessageSender;
    const result=await handleFloatingHost({type:"FLOAT_HOST_INIT"},host) as any;
    const sender={id:"aarre",frameId:4,documentId:"child-a",tab:{id:7},url:`chrome-extension://aarre/floating.html?tab=7&session=${result.nonce}`} as chrome.runtime.MessageSender;
    frames=[{frameId:4,parentFrameId:0,documentId:"child-a"}];
    await validateFloatingSender(sender,result.nonce); return {sender,result};
  }
  it("keeps the menu bound to its source, regardless of the active tab", async () => { const {sender}=await connect();expect((await authorizeUiMessage(sender))?.id).toBe(7); });
  it("rejects web pages invoking privileged messages",async()=>{await expect(authorizeUiMessage({id:"aarre",url:"https://source.example/page"})).rejects.toThrow();});
  it("rejects a forged nonce and a nested iframe",async()=>{const {sender}=await connect();await expect(validateFloatingSender(sender,"wrong")).rejects.toThrow();frames[0].parentFrameId=3;await expect(validateFloatingSender(sender)).rejects.toThrow();});
  it("rejects an old menu after parent navigation",async()=>{const {sender}=await connect();parent.documentId="parent-b";await expect(authorizeUiMessage(sender)).rejects.toThrow();});
  it("requires a new handshake after a child reload and rejects a replacement frame",async()=>{
    const {sender,result}=await connect();frames[0].documentId="child-b";sender.documentId="child-b";
    await expect(authorizeUiMessage(sender)).rejects.toThrow();await validateFloatingSender(sender,result.nonce);expect((await authorizeUiMessage(sender))?.id).toBe(7);
    frames[0].frameId=5;sender.frameId=5;await expect(validateFloatingSender(sender,result.nonce)).rejects.toThrow();
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

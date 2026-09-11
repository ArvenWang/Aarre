import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFloatingQuickSave } from "../src/extension/floating/quick-save";
import type { BookmarkSaveState, PageCapture, SaveBookmarkResult } from "../src/lib/types";

const sender = { id:"aarre", frameId:0, documentId:"source-doc", tab:{id:7}, url:"https://example.com/article" } as chrome.runtime.MessageSender;
let documentId: string, tab: chrome.tabs.Tab;
const deps = {
  getBookmarkSaveState: vi.fn<(_url:string) => Promise<BookmarkSaveState>>(),
  captureActivePage: vi.fn<(_id:number) => Promise<PageCapture>>(),
  saveBookmark: vi.fn<(...args:any[]) => Promise<SaveBookmarkResult>>(),
};
beforeEach(() => {
  vi.resetAllMocks(); documentId="source-doc";
  tab={id:7,url:sender.url,title:"The source page"} as chrome.tabs.Tab;
  vi.stubGlobal("chrome",{runtime:{id:"aarre"},storage:{session:{get:async(key:string)=>({[key]:{tabId:7,documentId:"source-doc",nonce:"trusted-host"}})}},
    webNavigation:{getFrame:async()=>({documentId})},tabs:{get:vi.fn(async()=>({...tab}))}});
  deps.getBookmarkSaveState.mockResolvedValue({matches:[]} as unknown as BookmarkSaveState);
  deps.captureActivePage.mockResolvedValue({url:sender.url,content:"Rendered source"} as PageCapture);
  deps.saveBookmark.mockResolvedValue({nativeBookmarkCreated:true} as SaveBookmarkResult);
});
afterEach(()=>vi.unstubAllGlobals());
describe("right-edge quick save",()=>{
  it("saves the verified source through the formal save flow and defers enrichment",async()=>{
    expect(await createFloatingQuickSave(deps)(sender,"trusted-host")).toEqual({existing:false});
    expect(deps.captureActivePage).toHaveBeenCalledWith(7);
    expect(deps.saveBookmark).toHaveBeenCalledWith(expect.objectContaining({sourceTabId:7,title:"The source page",capture:expect.objectContaining({url:sender.url})}),{deferEnrichment:true});
  });
  it("does not edit an already saved bookmark or request its page content",async()=>{
    deps.getBookmarkSaveState.mockResolvedValue({matches:[{id:"existing"}]} as unknown as BookmarkSaveState);
    expect(await createFloatingQuickSave(deps)(sender,"trusted-host")).toEqual({existing:true});
    expect(deps.captureActivePage).not.toHaveBeenCalled(); expect(deps.saveBookmark).not.toHaveBeenCalled();
  });
  it("coalesces concurrent clicks and releases the pending request after a failure",async()=>{
    let reject!: (error:Error)=>void;
    deps.captureActivePage.mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail;}));
    const save=createFloatingQuickSave(deps);
    const a=save(sender,"trusted-host"),b=save(sender,"trusted-host");
    await vi.waitFor(()=>expect(reject).toBeTypeOf("function"));
    deps.saveBookmark.mockRejectedValueOnce(new Error("disk full"));
    const result=Promise.allSettled([a,b]); reject(new Error("content unavailable"));
    expect((await result).map(r=>r.status)).toEqual(["rejected","rejected"]);
    expect(deps.saveBookmark).toHaveBeenCalledTimes(1);
    await save(sender,"trusted-host"); expect(deps.saveBookmark).toHaveBeenCalledTimes(2);
  });
  it.each(["wrong nonce","nested frame","other extension","stale document"])("rejects %s before reading or saving content",async(kind)=>{
    const requestSender={...sender}; let nonce="trusted-host";
    if(kind==="wrong nonce")nonce="forged";
    if(kind==="nested frame")requestSender.frameId=4;
    if(kind==="other extension")requestSender.id="other";
    if(kind==="stale document")documentId="replacement";
    await expect(createFloatingQuickSave(deps)(requestSender,nonce)).rejects.toThrow();
    expect(deps.getBookmarkSaveState).not.toHaveBeenCalled(); expect(deps.saveBookmark).not.toHaveBeenCalled();
  });
  it.each(["URL","document"])("does not save if the source %s changes during capture",async(kind)=>{
    deps.captureActivePage.mockImplementationOnce(async()=>{
      if(kind==="URL")tab.url="https://example.com/replacement"; else documentId="replacement";
      return {url:sender.url,content:"Old page"} as PageCapture;
    });
    await expect(createFloatingQuickSave(deps)(sender,"trusted-host")).rejects.toThrow();
    expect(deps.saveBookmark).not.toHaveBeenCalled();
  });
  it("still bookmarks metadata when reading page content is unavailable",async()=>{
    deps.captureActivePage.mockRejectedValue(new Error("protected page"));
    await createFloatingQuickSave(deps)(sender,"trusted-host");
    expect(deps.saveBookmark).toHaveBeenCalledWith(expect.objectContaining({capture:expect.objectContaining({url:sender.url,content:"",description:""})}),{deferEnrichment:true});
  });
});

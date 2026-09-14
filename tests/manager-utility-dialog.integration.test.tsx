// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ManagerApp } from "../src/ui/manager/ManagerApp";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../src/ui/manager/views/LibraryView", () => ({ LibraryView: () => <div>收藏内容</div> }));
vi.mock("../src/lib/display-settings", () => ({
  getDisplaySettings: async () => ({pageSnapshotsEnabled: true, snapshotExcludedHosts: []}),
  requestPageSnapshotPermission: async () => true,
}));
vi.mock("../src/lib/messages", () => ({ sendExtensionRequest: async ({type}: {type: string}) => {
  if (type === "GET_APP_STATE") return {auth: {configured:false, signedIn:false}};
  if (type === "GET_BOOKMARK_BAR") return {root:{id:"root",title:"书签栏",children:[]},roots:[],primaryRootId:"root",bookmarkCount:0,folderCount:0};
  if (type === "GET_LIBRARY_INSIGHTS") return {organizationPlan:{proposals:[],proposalCount:0}};
  if (type === "GET_KNOWLEDGE_DASHBOARD") return {weekly:{createdCount:0},topicGraph:{nodes:[]},resurfacing:[]};
  return [];
} }));

let root: Root | undefined;
afterEach(async()=>{
  await act(async()=>root?.unmount()); root=undefined;
  document.body.innerHTML="";
  vi.unstubAllGlobals();
  window.history.replaceState(null,"","/");
});

it("opens one backup dialog from a direct link and closes/reopens without leaving a hidden modal", async()=>{
  vi.stubGlobal("matchMedia",vi.fn(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}})));
  vi.stubGlobal("chrome",{storage:{local:{get:async()=>({}),set:async()=>{}}}});
  window.history.replaceState(null,"","/manager.html?archive=1");
  const container=document.createElement("div");document.body.append(container);root=createRoot(container);
  await act(async()=>{root!.render(<ManagerApp/>);});
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("选择备份文件");
  await act(async()=>{(document.querySelector('button[aria-label="关闭"]') as HTMLButtonElement).click();});
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  await act(async()=>{(container.querySelector('button[aria-label="本地备份与恢复"]') as HTMLButtonElement).click();});
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
});

it.each(["organize", "report", "resurface"])("redirects retired %s links to the library with only two available sections",async(view)=>{
  vi.stubGlobal("matchMedia",vi.fn(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}})));
  vi.stubGlobal("chrome",{storage:{local:{get:async()=>({}),set:async()=>{}}}});
  window.history.replaceState(null,"",`/manager.html?view=${view}&q=design`);
  const container=document.createElement("div");document.body.append(container);root=createRoot(container);
  await act(async()=>{root!.render(<ManagerApp/>);});
  expect([...container.querySelectorAll('[role="tab"]')].map(el=>el.textContent)).toEqual(["收藏库","主题图谱"]);
  expect(window.location.search).toBe("?q=design");
  expect(container.textContent).toContain("收藏内容");
});

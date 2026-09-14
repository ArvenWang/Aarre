// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SaveFormBody } from "../src/ui/floating/SaveFormBody";
import { postToFloatingHost } from "../src/ui/floating/bridge";
vi.mock("../src/ui/floating/bridge", () => ({ postToFloatingHost: vi.fn(), getFloatingSaveLayoutRequest: () => "save-layout", FLOATING_SAVE_EVENT: "save-request" }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, callbacks: (() => void)[], contentHeight: number;
beforeEach(() => {
  vi.clearAllMocks(); callbacks = []; contentHeight = 300;
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { callbacks.push(cb); } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function(this: HTMLElement) {
    return this.classList.contains("save-form-content") ? contentHeight : this.classList.contains("native-dialog-heading") ? 48 : 60;
  });
  // Entry animation scales the visual rectangle. It must not enlarge the panel.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({height:999} as DOMRect);
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(compact = true, loading = false) {
  await act(async () => root.render(<div className="floating-save-page">
    <div className="native-dialog-heading">添加到收藏</div>
    <div style={{paddingTop:12,paddingBottom:16}}><SaveFormBody compact={compact} loading={loading}>实际表单内容</SaveFormBody></div>
    {!loading && <div className="native-dialog-actions">保存</div>}
  </div>));
}
it("measures untransformed content, reacts to disclosure growth, and sends no resize feedback for unchanged height", async () => {
  await render(); expect(postToFloatingHost).toHaveBeenLastCalledWith({type:"FLOAT_SAVE_LAYOUT",height:436,ready:true,requestId:"save-layout"});
  vi.mocked(postToFloatingHost).mockClear();
  await act(async () => callbacks.at(-1)!()); expect(postToFloatingHost).not.toHaveBeenCalled();
  contentHeight = 400;
  await act(async () => callbacks.at(-1)!()); expect(postToFloatingHost).toHaveBeenLastCalledWith({type:"FLOAT_SAVE_LAYOUT",height:536,ready:true,requestId:"save-layout"});
  await render(false); expect(postToFloatingHost).toHaveBeenLastCalledWith({type:"FLOAT_WORKSPACE_LAYOUT"});
});
it("keeps a stable loading size and never requests a compact host for an ordinary editor", async () => {
  await render(false); expect(postToFloatingHost).not.toHaveBeenCalled();
  await render(true,true); expect(postToFloatingHost).toHaveBeenLastCalledWith({type:"FLOAT_SAVE_LAYOUT",height:560,ready:false,requestId:"save-layout"});
  await render(true,false); expect(postToFloatingHost).toHaveBeenLastCalledWith({type:"FLOAT_SAVE_LAYOUT",height:436,ready:true,requestId:"save-layout"});
});

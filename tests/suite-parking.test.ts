import { afterEach, expect, it, vi } from "vitest";
import { createFrameParking, prepareToPark, registerParkPreparation } from "../src/shared/suite-dock/parking";

afterEach(() => { vi.useRealTimers(); });
it("waits for every local draft write before declaring the frame releasable", async () => {
  vi.useFakeTimers(); let saved = false, finish!: () => void;
  const unregister = registerParkPreparation(() => new Promise<void>(resolve => { finish = () => { saved = true; resolve(); }; }));
  let ready = false; const pending = prepareToPark().then(() => { ready = true; });
  await vi.advanceTimersByTimeAsync(0); expect(ready).toBe(false);
  finish(); await pending; expect(saved && ready).toBe(true); unregister();
});
it("keeps a busy or unsaved UI alive instead of silently discarding its state", async () => {
  vi.useFakeTimers(); const unregister = registerParkPreparation(() => { throw new Error("草稿暂时未能保存"); });
  const failed = expect(prepareToPark()).rejects.toThrow("草稿暂时未能保存");
  await vi.advanceTimersByTimeAsync(0); await failed; unregister();
});
it("rejects stale acknowledgements and bounds an unresponsive frame", async () => {
  vi.useFakeTimers(); const send = vi.fn(), parking = createFrameParking(send);
  const pending = parking.prepare(), failed = expect(pending).rejects.toThrow("菜单尚未完成保存");
  parking.receive({ type: "SUITE_PARK_READY", id: "different-frame-request", ok: true });
  await vi.advanceTimersByTimeAsync(1_800); await failed;
  const next = parking.prepare(); parking.receive({ type: "SUITE_PARK_READY", id: send.mock.calls.at(-1)![0].id, ok: true });
  await expect(next).resolves.toBeUndefined();
});

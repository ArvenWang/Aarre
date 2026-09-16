// UI-local persistence barrier. Business state stays inside its own extension.
import { randomId } from "./contract";
const preparations = new Set<() => unknown | Promise<unknown>>();
export function registerParkPreparation(prepare: () => unknown | Promise<unknown>) {
  preparations.add(prepare);
  return () => { preparations.delete(prepare); };
}
export async function prepareToPark() {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await Promise.all([...preparations].map(prepare => prepare()));
}
export function createFrameParking(send: (message: Record<string, unknown>) => void) {
  let pending: { id: string; finish: (ok: boolean, error?: string) => void } | undefined;
  return {
    prepare() {
      return new Promise<void>((resolve, reject) => {
        if (pending) { reject(new Error("菜单正在切换，请稍候。")); return; }
        const id = randomId();
        const timer = setTimeout(() => pending?.finish(false, "菜单尚未完成保存，请重试。"), 1_800);
        pending = { id, finish(ok, error) { clearTimeout(timer); pending = undefined; if (ok) resolve(); else reject(new Error(error || "菜单暂时无法切换，请重试。")); } };
        send({ type: "SUITE_PREPARE_PARK", id });
      });
    },
    receive(message: Record<string, unknown>) {
      if (message.type !== "SUITE_PARK_READY" || message.id !== pending?.id) return;
      pending?.finish(message.ok === true, typeof message.error === "string" ? message.error : undefined);
    },
    destroy() { pending?.finish(false, "菜单已关闭。"); },
  };
}

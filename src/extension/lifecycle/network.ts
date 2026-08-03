export function registerNetworkRecovery(requestSync: (reason: string) => void): void {
  globalThis.addEventListener("online", () => requestSync("network-restored"));
}

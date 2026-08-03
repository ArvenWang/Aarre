/**
 * Cold-start facade for fire-and-forget sync triggers. The actual sync engine
 * pulls in the complete cloud state and asset pipelines, so it is loaded only
 * after a trigger exists.
 */
export function requestSync(reason: string, debounceMs?: number): void {
  void import("./sync-engine").then(({ requestSync: schedule }) => {
    schedule(reason, debounceMs);
  });
}

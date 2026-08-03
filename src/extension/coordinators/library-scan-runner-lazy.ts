import { getStoredLibraryScan, publicLibraryScan } from "./library-scan-state";

export function createLibraryScanRunner(dependencies: any): Record<string, any> {
  let loaded: Promise<Record<string, any>> | undefined;
  const load = () => loaded ||= import("./library-scan-runner").then(
    (module) => module.createLibraryScanRunner(dependencies) as Record<string, any>,
  );
  return {
    getStoredLibraryScan,
    publicLibraryScan,
    startLibraryScan: (...args: any[]) => load().then((runner) => runner.startLibraryScan(...args)),
    updateLibraryScanState: (...args: any[]) => load().then((runner) => runner.updateLibraryScanState(...args)),
    runLibraryScan: (...args: any[]) => load().then((runner) => runner.runLibraryScan(...args)),
  };
}

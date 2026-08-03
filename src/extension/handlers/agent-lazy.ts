const METHOD_NAMES = [
  "askAgent",
  "cancelAgent",
  "cancelAllAgentRuns",
  "dismissOrganizationNotice",
  "ensureStoredOrganizationInsights",
  "getContextResurfacing",
  "getFolderSuggestions",
  "getKnowledgeDashboard",
  "getLibraryInsights",
  "getOrganizationNotice",
  "syncOrganizationBadge",
] as const;

/** Lazy boundary for Agent, organization analysis and knowledge dashboards. */
export function createAgentHandlers(dependencies: any): Record<string, any> {
  let loaded: Promise<Record<string, any>> | undefined;
  const load = () =>
    loaded ||= import("./agent").then((module) =>
      module.createAgentHandlers(dependencies) as Record<string, any>,
    );
  return Object.fromEntries(
    METHOD_NAMES.map((name) => [
      name,
      (...args: any[]) => load().then((handlers) => handlers[name](...args)),
    ]),
  );
}

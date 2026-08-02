import type { ResourceRecord } from "./types";

export const PROTECTION_SETTINGS_KEY = "aarre:protection-settings:v1";

const MAX_PROTECTED_ITEMS = 5_000;

export interface ProtectionSettings {
  resourceKeys: string[];
  folderIds: string[];
}

export interface ProtectionTreeNode {
  id: string;
  url?: string;
  children?: ProtectionTreeNode[];
}

export interface ProtectionPolicy {
  explicitResourceKeys: ReadonlySet<string>;
  explicitFolderIds: ReadonlySet<string>;
  protectedFolderIds: ReadonlySet<string>;
  protectedBookmarkIds: ReadonlySet<string>;
}

export interface ItemProtectionState {
  protected: boolean;
  explicit: boolean;
  inherited: boolean;
}

const DEFAULT_PROTECTION_SETTINGS: ProtectionSettings = {
  resourceKeys: [],
  folderIds: [],
};

let settingsMutation = Promise.resolve();

function normalizedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_PROTECTED_ITEMS);
}

export function normalizeProtectionSettings(
  value: Partial<ProtectionSettings> | null | undefined,
): ProtectionSettings {
  return {
    resourceKeys: normalizedIds(value?.resourceKeys),
    folderIds: normalizedIds(value?.folderIds),
  };
}

export async function getProtectionSettings(): Promise<ProtectionSettings> {
  const stored = (await chrome.storage.local.get(PROTECTION_SETTINGS_KEY))[
    PROTECTION_SETTINGS_KEY
  ] as Partial<ProtectionSettings> | undefined;
  return normalizeProtectionSettings(stored);
}

export async function saveProtectionSettings(
  settings: ProtectionSettings,
): Promise<ProtectionSettings> {
  const normalized = normalizeProtectionSettings(settings);
  await chrome.storage.local.set({
    [PROTECTION_SETTINGS_KEY]: normalized,
  });
  return normalized;
}

async function mutateProtectionSettings(
  mutate: (current: ProtectionSettings) => ProtectionSettings,
): Promise<ProtectionSettings> {
  let result = DEFAULT_PROTECTION_SETTINGS;
  const operation = settingsMutation.then(async () => {
    result = await saveProtectionSettings(mutate(await getProtectionSettings()));
  });
  settingsMutation = operation.catch(() => undefined);
  await operation;
  return result;
}

function withMembership(
  values: string[],
  value: string,
  enabled: boolean,
): string[] {
  const next = new Set(values);
  if (enabled) next.add(value);
  else next.delete(value);
  return [...next];
}

export function setResourceProtection(
  resourceKey: string,
  enabled: boolean,
): Promise<ProtectionSettings> {
  const normalized = resourceKey.trim();
  if (!normalized) throw new Error("没有找到这条网页收藏的保护身份。");
  return mutateProtectionSettings((current) => ({
    ...current,
    resourceKeys: withMembership(current.resourceKeys, normalized, enabled),
  }));
}

export function setFolderProtection(
  folderId: string,
  enabled: boolean,
): Promise<ProtectionSettings> {
  const normalized = folderId.trim();
  if (!normalized) throw new Error("没有找到这个文件夹的保护身份。");
  return mutateProtectionSettings((current) => ({
    ...current,
    folderIds: withMembership(current.folderIds, normalized, enabled),
  }));
}

export function removeFolderProtections(
  folderIds: Iterable<string>,
): Promise<ProtectionSettings> {
  const removed = new Set(folderIds);
  return mutateProtectionSettings((current) => ({
    ...current,
    folderIds: current.folderIds.filter((id) => !removed.has(id)),
  }));
}

/**
 * Folder protection is evaluated against the current Chrome tree every time a
 * privacy-sensitive operation starts. A bookmark added tomorrow therefore
 * inherits protection without copying today's descendant URLs into storage.
 */
export function buildProtectionPolicy(
  tree: readonly ProtectionTreeNode[],
  settings: ProtectionSettings,
): ProtectionPolicy {
  const explicitResourceKeys = new Set(settings.resourceKeys);
  const explicitFolderIds = new Set(settings.folderIds);
  const protectedFolderIds = new Set<string>();
  const protectedBookmarkIds = new Set<string>();

  function visit(node: ProtectionTreeNode, protectedByParent: boolean) {
    if (node.url) {
      if (protectedByParent) protectedBookmarkIds.add(node.id);
      return;
    }

    const protectedFolder =
      protectedByParent || explicitFolderIds.has(node.id);
    if (protectedFolder) protectedFolderIds.add(node.id);
    for (const child of node.children || []) {
      visit(child, protectedFolder);
    }
  }

  for (const root of tree) visit(root, false);

  return {
    explicitResourceKeys,
    explicitFolderIds,
    protectedFolderIds,
    protectedBookmarkIds,
  };
}

export function isResourceUserProtected(
  resource: Pick<ResourceRecord, "resourceKey" | "nativeBookmarkIds">,
  policy: ProtectionPolicy,
): boolean {
  return (
    policy.explicitResourceKeys.has(resource.resourceKey) ||
    resource.nativeBookmarkIds.some((id) =>
      policy.protectedBookmarkIds.has(id),
    )
  );
}

export function bookmarkProtectionState(
  resourceKey: string,
  bookmarkId: string,
  policy: ProtectionPolicy,
): ItemProtectionState {
  const explicit = policy.explicitResourceKeys.has(resourceKey);
  const inherited = policy.protectedBookmarkIds.has(bookmarkId);
  return {
    protected: explicit || inherited,
    explicit,
    inherited,
  };
}

export function folderProtectionState(
  folderId: string,
  policy: ProtectionPolicy,
): ItemProtectionState {
  const explicit = policy.explicitFolderIds.has(folderId);
  const inherited =
    !explicit && policy.protectedFolderIds.has(folderId);
  return {
    protected: explicit || inherited,
    explicit,
    inherited,
  };
}

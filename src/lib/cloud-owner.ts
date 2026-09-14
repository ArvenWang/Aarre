/** Non-secret identity only; bind every write in a multi-request job to its starting account. */
export async function cloudOwner(): Promise<string | undefined> {
  const key = "aarre:cloud-session:v1";
  const session = (await chrome.storage.local.get(key))[key] as { userId?: string } | undefined;
  return session?.userId;
}

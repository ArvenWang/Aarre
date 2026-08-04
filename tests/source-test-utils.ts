import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function sourceFiles(
  directory: URL,
  extensions = new Set([".ts", ".tsx"]),
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory.pathname, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await sourceFiles(
          new URL(`${entry.name}/`, directory),
          extensions,
        )),
      );
      continue;
    }
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (extensions.has(extension)) files.push(path);
  }
  return files.sort();
}

export async function readAllSources(directory: URL): Promise<string> {
  const files = await sourceFiles(directory);
  const sources = await Promise.all(
    files.map(async (file) => `// FILE: ${file}\n${await readFile(file, "utf8")}`),
  );
  return sources.join("\n");
}

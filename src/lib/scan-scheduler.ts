import { registrableHost } from "./cover-registry";
import type { ResourceRecord } from "./types";

function resourceHost(resource: ResourceRecord): string {
  try {
    return registrableHost(
      new URL(resource.url).hostname.toLocaleLowerCase()
    );
  } catch {
    return `invalid:${resource.resourceKey}`;
  }
}

export function interleaveResourcesByHost(
  resources: ResourceRecord[]
): ResourceRecord[] {
  const buckets = new Map<string, ResourceRecord[]>();
  for (const resource of resources) {
    const host = resourceHost(resource);
    const bucket = buckets.get(host) || [];
    bucket.push(resource);
    buckets.set(host, bucket);
  }
  const ordered: ResourceRecord[] = [];
  while (buckets.size) {
    for (const [host, bucket] of buckets) {
      const next = bucket.shift();
      if (next) ordered.push(next);
      if (!bucket.length) buckets.delete(host);
    }
  }
  return ordered;
}

export class DomainRateLimiter {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly lastStartedAt = new Map<string, number>();

  constructor(
    private readonly intervalMs = 1_000,
    private readonly now: () => number = () => Date.now(),
    private readonly wait: (milliseconds: number) => Promise<void> = (
      milliseconds
    ) =>
      new Promise((resolve) => {
        globalThis.setTimeout(resolve, milliseconds);
      })
  ) {}

  async run<T>(url: string, task: () => Promise<T>): Promise<T> {
    let host = url;
    try {
      host = registrableHost(
        new URL(url).hostname.toLocaleLowerCase()
      );
    } catch {
      // Invalid URLs still receive their own serialized bucket.
    }
    const previous = this.queues.get(host) || Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.queues.set(host, queued);
    await previous;
    try {
      const lastStartedAt = this.lastStartedAt.get(host);
      const remaining =
        lastStartedAt === undefined
          ? 0
          : lastStartedAt + this.intervalMs - this.now();
      if (remaining > 0) await this.wait(remaining);
      this.lastStartedAt.set(host, this.now());
      return await task();
    } finally {
      release();
      if (this.queues.get(host) === queued) {
        this.queues.delete(host);
      }
    }
  }
}

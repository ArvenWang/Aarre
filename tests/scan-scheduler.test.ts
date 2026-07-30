import { describe, expect, it } from "vitest";
import {
  DomainRateLimiter,
  interleaveResourcesByHost
} from "../src/lib/scan-scheduler";
import type { ResourceRecord } from "../src/lib/types";

function resource(id: string, host: string): ResourceRecord {
  return {
    resourceKey: id,
    canonicalUrl: `https://${host}/${id}`,
    url: `https://${host}/${id}`,
    title: id,
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: host,
    language: "",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [id],
    nativeFolderPath: [],
    aiStatus: "not_requested",
    syncStatus: "local",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z"
  };
}

describe("scan scheduler", () => {
  it("round-robins domains before returning to the same host", () => {
    const ordered = interleaveResourcesByHost([
      resource("a1", "a.example.com"),
      resource("a2", "a.example.com"),
      resource("b1", "b.example.org"),
      resource("b2", "b.example.org"),
      resource("c1", "c.example.net")
    ]);
    expect(ordered.map((item) => item.resourceKey)).toEqual([
      "a1",
      "b1",
      "c1",
      "a2",
      "b2"
    ]);
  });

  it("serializes a domain and waits from the previous task completion", async () => {
    let clock = 10_000;
    const starts: number[] = [];
    const limiter = new DomainRateLimiter(
      1_000,
      () => clock,
      async (milliseconds) => {
        clock += milliseconds;
      }
    );
    await Promise.all([
      limiter.run("https://docs.example.com/a", async () => {
        starts.push(clock);
      }),
      limiter.run("https://www.example.com/b", async () => {
        starts.push(clock);
      })
    ]);
    expect(starts).toEqual([10_000, 11_000]);
  });

  it("waits one second after a slow same-domain task finishes", async () => {
    let clock = 10_000;
    const starts: number[] = [];
    const limiter = new DomainRateLimiter(
      1_000,
      () => clock,
      async (milliseconds) => {
        clock += milliseconds;
      }
    );

    await Promise.all([
      limiter.run("https://docs.example.com/a", async () => {
        starts.push(clock);
        clock += 3_000;
      }),
      limiter.run("https://www.example.com/b", async () => {
        starts.push(clock);
      })
    ]);

    expect(starts).toEqual([10_000, 14_000]);
  });

  it("still throttles the next same-domain task after a failure", async () => {
    let clock = 10_000;
    const starts: number[] = [];
    const limiter = new DomainRateLimiter(
      1_000,
      () => clock,
      async (milliseconds) => {
        clock += milliseconds;
      }
    );

    const results = await Promise.allSettled([
      limiter.run("https://docs.example.com/a", async () => {
        starts.push(clock);
        clock += 250;
        throw new Error("request failed");
      }),
      limiter.run("https://www.example.com/b", async () => {
        starts.push(clock);
      })
    ]);

    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("fulfilled");
    expect(starts).toEqual([10_000, 11_250]);
  });

  it("does not make different domains wait for each other", async () => {
    const order: string[] = [];
    let finishFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const limiter = new DomainRateLimiter(1_000);

    const first = limiter.run("https://example.com/a", async () => {
      order.push("a:start");
      await gate;
      order.push("a:end");
    });
    const second = limiter.run("https://example.org/b", async () => {
      order.push("b:start");
    });

    await second;
    expect(order).toEqual(["a:start", "b:start"]);
    finishFirst?.();
    await first;
  });
});

import { searchLocalResources } from "./search";
import type {
  BookmarkAgentCatalog,
  BookmarkAgentCatalogBookmark,
  KnowledgeDashboard,
  KnowledgeGap,
  LibraryReport,
  ResurfacingItem,
  ResourceRecord,
  TopicGraph,
  TopicTrend
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1_000;

interface DatedResource {
  resource: ResourceRecord;
  dateAdded: number;
  dateLastUsed?: number;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC").trim();
}

function datedResources(
  resources: ResourceRecord[],
  catalog: BookmarkAgentCatalog
): DatedResource[] {
  const nodeById = new Map(
    catalog.bookmarks.map((node) => [node.id, node])
  );
  return resources.map((resource) => {
    const nodes = resource.nativeBookmarkIds
      .map((id) => nodeById.get(id))
      .filter((node): node is BookmarkAgentCatalogBookmark => Boolean(node));
    const dates = nodes
      .map((node) => node.dateAdded)
      .filter((value): value is number => typeof value === "number");
    const usedDates = nodes
      .map((node) => node.dateLastUsed)
      .filter((value): value is number => typeof value === "number");
    return {
      resource,
      dateAdded:
        dates.length > 0
          ? Math.min(...dates)
          : Date.parse(resource.createdAt) || 0,
      ...(usedDates.length > 0
        ? { dateLastUsed: Math.max(...usedDates) }
        : {})
    };
  });
}

function topicCounts(
  items: DatedResource[],
  start: number,
  end: number
): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) {
    if (item.dateAdded < start || item.dateAdded >= end) continue;
    for (const rawTopic of item.resource.topics) {
      const topic = normalize(rawTopic);
      if (!topic) continue;
      result.set(topic, (result.get(topic) || 0) + 1);
    }
  }
  return result;
}

function topTrends(
  current: Map<string, number>,
  previous: Map<string, number>
): TopicTrend[] {
  return [...new Set([...current.keys(), ...previous.keys()])]
    .map((topic) => ({
      topic,
      current: current.get(topic) || 0,
      previous: previous.get(topic) || 0
    }))
    .sort(
      (left, right) =>
        right.current - left.current ||
        right.current - right.previous -
          (left.current - left.previous) ||
        left.topic.localeCompare(right.topic)
    )
    .slice(0, 8);
}

function attentionShift(
  current: Map<string, number>,
  previous: Map<string, number>,
  periodLabel: string
): string {
  const currentTop = [...current.entries()].sort(
    (left, right) => right[1] - left[1]
  )[0];
  const previousTop = [...previous.entries()].sort(
    (left, right) => right[1] - left[1]
  )[0];
  if (!currentTop) {
    return `${periodLabel}没有新增足够的主题信息，先继续正常收藏即可。`;
  }
  if (!previousTop) {
    return `${periodLabel}最集中的关注点是“${currentTop[0]}”，共新增 ${currentTop[1]} 条。`;
  }
  if (currentTop[0] === previousTop[0]) {
    return `你的关注点继续集中在“${currentTop[0]}”，本期 ${currentTop[1]} 条，上期 ${previousTop[1]} 条。`;
  }
  return `你的关注重点从“${previousTop[0]}”转向“${currentTop[0]}”：本期分别为 ${current.get(previousTop[0]) || 0} 条和 ${currentTop[1]} 条。`;
}

function knowledgeGaps(items: DatedResource[]): KnowledgeGap[] {
  const angleRules = [
    {
      label: "入门与原理",
      terms: ["入门", "基础", "原理", "介绍", "概览", "intro", "overview"]
    },
    {
      label: "实现与实战",
      terms: [
        "实现",
        "教程",
        "实战",
        "代码",
        "实践",
        "build",
        "implementation",
        "tutorial"
      ]
    },
    {
      label: "评测与对比",
      terms: ["评测", "评估", "指标", "对比", "benchmark", "evaluation"]
    },
    {
      label: "上线与运维",
      terms: [
        "上线",
        "生产",
        "部署",
        "运维",
        "监控",
        "production",
        "deploy",
        "monitoring"
      ]
    },
    {
      label: "风险与反例",
      terms: [
        "安全",
        "风险",
        "失败",
        "反例",
        "缺陷",
        "security",
        "failure",
        "pitfall"
      ]
    },
    {
      label: "案例与复盘",
      terms: ["案例", "复盘", "case study", "postmortem"]
    }
  ] as const;
  const priorityAngles = ["评测与对比", "上线与运维", "风险与反例"];
  const byTopic = new Map<string, DatedResource[]>();
  for (const item of items) {
    for (const rawTopic of item.resource.topics) {
      const topic = normalize(rawTopic);
      if (!topic) continue;
      const group = byTopic.get(topic) || [];
      group.push(item);
      byTopic.set(topic, group);
    }
  }
  return [...byTopic.entries()]
    .filter(([, group]) => group.length >= 4)
    .map(([topic, group]) => {
      const angles = new Set<string>();
      for (const item of group) {
        const content = normalize(
          [
            item.resource.title,
            item.resource.summary,
            ...item.resource.tags
          ].join(" ")
        );
        for (const rule of angleRules) {
          if (rule.terms.some((term) => content.includes(term))) {
            angles.add(rule.label);
          }
        }
      }
      const missing = priorityAngles.filter((angle) => !angles.has(angle));
      const covered = [...angles];
      return {
        topic,
        resourceCount: group.length,
        angleCount: angles.size,
        message:
          missing.length > 0
            ? `你在“${topic}”上收了 ${group.length} 条${covered.length ? `，已有${covered.join("、")}` : ""}，但还缺${missing.join("、")}；下一篇可以刻意补齐。`
            : `“${topic}”已有 ${group.length} 条，评测、上线和风险方向都有覆盖，结构相对完整。`
      };
    })
    .sort(
      (left, right) =>
        right.resourceCount - left.resourceCount ||
        left.angleCount - right.angleCount
    )
    .slice(0, 5);
}

function buildResurfacing(
  items: DatedResource[],
  nowMs: number,
  query = "",
  limit = 12
): ResurfacingItem[] {
  const recentTopics = new Set(
    items
      .filter((item) => nowMs - item.dateAdded <= 30 * DAY_MS)
      .flatMap((item) => item.resource.topics.map(normalize))
      .filter(Boolean)
  );
  const lexicalScores = new Map(
    query.trim()
      ? searchLocalResources(
          items.map((item) => item.resource),
          query
        ).map((result) => [result.resource.resourceKey, result.score || 0])
      : []
  );
  return items
    .map((item) => {
      const ageDays = Math.max(
        0,
        Math.floor((nowMs - item.dateAdded) / DAY_MS)
      );
      const topicMatches = item.resource.topics
        .map(normalize)
        .filter((topic) => recentTopics.has(topic));
      const lexical = lexicalScores.get(item.resource.resourceKey) || 0;
      const recencyPenalty =
        item.dateLastUsed &&
        nowMs - item.dateLastUsed < 30 * DAY_MS
          ? 30
          : 0;
      const score =
        topicMatches.length * 22 +
        lexical +
        Math.min(24, ageDays / 15) -
        recencyPenalty;
      const reason = lexical
        ? `与你当前浏览的内容相关，且已收藏 ${ageDays} 天`
        : topicMatches.length
          ? `与你最近关注的“${topicMatches[0]}”相关`
          : `已收藏 ${ageDays} 天，很少通过书签重新打开`;
      return { item, ageDays, score, reason };
    })
    .filter(
      ({ item, ageDays, score }) =>
        ageDays >= 90 &&
        score > 0 &&
        (!query.trim() || lexicalScores.has(item.resource.resourceKey))
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.ageDays - left.ageDays
    )
    .slice(0, limit)
    .map(({ item, ageDays, score, reason }) => ({
      resourceKey: item.resource.resourceKey,
      title: item.resource.title,
      url: item.resource.url,
      path: item.resource.nativeFolderPath,
      ageDays,
      score: Number(score.toFixed(2)),
      reason
    }));
}

function topicGraph(resources: ResourceRecord[]): TopicGraph {
  const nodeCounts = new Map<string, number>();
  for (const resource of resources) {
    for (const topic of new Set(resource.topics.map(normalize).filter(Boolean))) {
      nodeCounts.set(topic, (nodeCounts.get(topic) || 0) + 1);
    }
  }
  const nodes = [...nodeCounts.entries()]
    .sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0])
    )
    .slice(0, 24)
    .map(([label, count]) => ({ id: label, label, count }));
  const allowed = new Set(nodes.map((node) => node.id));
  const edgeCounts = new Map<string, number>();
  for (const resource of resources) {
    const topics = [
      ...new Set(
        resource.topics.map(normalize).filter((topic) => allowed.has(topic))
      )
    ].sort();
    for (let left = 0; left < topics.length; left += 1) {
      for (let right = left + 1; right < topics.length; right += 1) {
        const key = `${topics[left]}\n${topics[right]}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }
  }
  return {
    nodes,
    edges: [...edgeCounts.entries()]
      .map(([key, weight]) => {
        const [source, target] = key.split("\n");
        return { source, target, weight };
      })
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 60)
  };
}

function report(
  period: "week" | "month",
  items: DatedResource[],
  catalog: BookmarkAgentCatalog,
  nowMs: number
): LibraryReport {
  const windowDays = period === "week" ? 7 : 30;
  const start = nowMs - windowDays * DAY_MS;
  const previousStart = start - windowDays * DAY_MS;
  const current = topicCounts(items, start, nowMs + 1);
  const previous = topicCounts(items, previousStart, start);
  const bookmarkCountByFolder = new Map<string, number>();
  for (const bookmark of catalog.bookmarks) {
    bookmarkCountByFolder.set(
      bookmark.parentId,
      (bookmarkCountByFolder.get(bookmark.parentId) || 0) + 1
    );
  }
  return {
    period,
    startAt: new Date(start).toISOString(),
    endAt: new Date(nowMs).toISOString(),
    createdCount: items.filter(
      (item) => item.dateAdded >= start && item.dateAdded <= nowMs
    ).length,
    attentionShift: attentionShift(
      current,
      previous,
      period === "week" ? "本周" : "本月"
    ),
    topicTrends: topTrends(current, previous),
    rarelyOpenedOver90Days: items.filter(
      (item) =>
        nowMs - item.dateAdded >= 90 * DAY_MS &&
        (!item.dateLastUsed ||
          nowMs - item.dateLastUsed >= 90 * DAY_MS)
    ).length,
    knowledgeGaps: knowledgeGaps(items),
    resurfacing: buildResurfacing(items, nowMs, "", 5),
    health: {
      deadLinks: items.filter(
        (item) => item.resource.linkHealth?.status === "dead"
      ).length,
      newlyDetectedDeadLinks: items.filter(
        (item) =>
          item.resource.linkHealth?.status === "dead" &&
          Date.parse(item.resource.linkHealth.checkedAt) >= start
      ).length,
      largeFolders: catalog.folders.filter(
        (folder) => (bookmarkCountByFolder.get(folder.id) || 0) > 150
      ).length
    }
  };
}

export function buildKnowledgeDashboard(
  resources: ResourceRecord[],
  catalog: BookmarkAgentCatalog,
  nowMs = Date.now()
): KnowledgeDashboard {
  const items = datedResources(resources, catalog);
  return {
    weekly: report("week", items, catalog, nowMs),
    monthly: report("month", items, catalog, nowMs),
    topicGraph: topicGraph(resources),
    resurfacing: buildResurfacing(items, nowMs)
  };
}

export function resurfaceForContext(
  resources: ResourceRecord[],
  catalog: BookmarkAgentCatalog,
  query: string,
  nowMs = Date.now()
): ResurfacingItem[] {
  if (!query.trim()) return [];
  return buildResurfacing(
    datedResources(resources, catalog),
    nowMs,
    query,
    3
  );
}

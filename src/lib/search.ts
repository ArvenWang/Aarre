import { pinyin } from "pinyin-pro";
import type { ResourceRecord, SearchResult } from "./types";

interface IndexedFields {
  title: string;
  aliases: string;
  tags: string;
  topics: string;
  summary: string;
  note: string;
  excerpt: string;
  url: string;
  folder: string;
}

export interface LocalSearchIndexItem {
  resource: ResourceRecord;
  fields: IndexedFields;
  pinyinInitials: string;
  pinyinFull: string;
  chineseBigrams: Set<string>;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC");
}

function compact(value: string): string {
  return normalize(value).replace(/[\s\-_./]+/g, "");
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (const sequence of normalize(value).match(/[\u3400-\u9fff]+/g) || []) {
    if (sequence.length === 1) result.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) {
      result.add(sequence.slice(index, index + 2));
    }
  }
  return result;
}

function searchableText(fields: IndexedFields): string {
  return [
    fields.title,
    fields.aliases,
    fields.tags,
    fields.topics,
    fields.summary,
    fields.note,
    fields.excerpt,
    fields.folder
  ]
    .join(" ")
    .slice(0, 4_000);
}

export function buildLocalSearchIndex(
  resources: ResourceRecord[]
): LocalSearchIndexItem[] {
  return resources.map((resource) => {
    const fields: IndexedFields = {
      title: normalize(resource.title),
      aliases: normalize((resource.aliases || []).join(" ")),
      tags: normalize(resource.tags.join(" ")),
      topics: normalize(resource.topics.join(" ")),
      summary: normalize(resource.summary),
      note: normalize(resource.userNote),
      excerpt: normalize(resource.contentExcerpt),
      url: normalize(resource.url),
      folder: normalize(resource.nativeFolderPath.join(" "))
    };
    const text = searchableText(fields);
    return {
      resource,
      fields,
      pinyinInitials: compact(
        pinyin(text, {
          pattern: "first",
          toneType: "none",
          type: "array",
          nonZh: "consecutive"
        }).join("")
      ),
      pinyinFull: compact(
        pinyin(text, {
          toneType: "none",
          type: "array",
          nonZh: "consecutive"
        }).join("")
      ),
      chineseBigrams: bigrams(text)
    };
  });
}

function matchScore(
  item: LocalSearchIndexItem,
  normalizedQuery: string,
  terms: string[]
): { score: number; reason: string } {
  const { fields } = item;
  let score = 0;
  let reason = "";
  const scoreField = (
    field: keyof IndexedFields,
    weight: number,
    label: string
  ) => {
    if (fields[field].includes(normalizedQuery)) {
      score += weight;
      if (!reason) reason = label;
    }
    for (const term of terms) {
      if (fields[field].includes(term)) score += weight / 3;
    }
  };

  scoreField("title", 30, "标题");
  scoreField("aliases", 26, "检索别名");
  scoreField("tags", 20, "标签");
  scoreField("topics", 16, "主题");
  scoreField("summary", 12, "摘要");
  scoreField("note", 12, "备注");
  scoreField("folder", 8, "文件夹");
  scoreField("excerpt", 5, "正文摘录");
  scoreField("url", 3, "网址");

  const compactQuery = compact(normalizedQuery);
  if (/^[a-z0-9]+$/i.test(compactQuery) && compactQuery.length >= 2) {
    if (item.pinyinInitials.includes(compactQuery)) {
      score += 22;
      if (!reason) reason = "拼音首字母";
    } else if (item.pinyinFull.includes(compactQuery)) {
      score += 18;
      if (!reason) reason = "拼音";
    }
  }

  const queryBigrams = bigrams(normalizedQuery);
  if (queryBigrams.size) {
    const matched = [...queryBigrams].filter((value) =>
      item.chineseBigrams.has(value)
    ).length;
    if (matched) {
      score += (matched / queryBigrams.size) * 14;
      if (!reason) reason = "中文词组";
    }
  }

  return { score, reason };
}

export function searchLocalIndex(
  index: LocalSearchIndexItem[],
  query: string
): SearchResult[] {
  const normalizedQuery = normalize(query).trim();
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return index.map(({ resource }) => ({ resource }));
  }

  return index
    .map((item) => {
      const matched = matchScore(item, normalizedQuery, terms);
      return {
        resource: item.resource,
        score: matched.score,
        matchReason: matched.reason
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        (b.score || 0) - (a.score || 0) ||
        b.resource.updatedAt.localeCompare(a.resource.updatedAt)
    );
}

export function searchLocalResources(
  resources: ResourceRecord[],
  query: string
): SearchResult[] {
  return searchLocalIndex(buildLocalSearchIndex(resources), query);
}

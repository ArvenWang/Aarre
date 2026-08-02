import type { ResourceRecord, SearchResult } from "./types";

type PinyinConverter = (
  value: string,
  options: {
    pattern?: "first";
    toneType: "none";
    type: "array";
    nonZh: "consecutive";
  }
) => string[];

export type PinyinLoader = () => Promise<PinyinConverter>;

let defaultPinyinLoader: Promise<PinyinConverter | null> | undefined;

interface IndexedFields {
  title: string;
  questions: string;
  aliases: string;
  tags: string;
  useCases: string;
  entities: string;
  topics: string;
  contentType: string;
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
  pinyinReady: boolean;
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
    fields.questions,
    fields.aliases,
    fields.tags,
    fields.useCases,
    fields.entities,
    fields.topics,
    fields.contentType,
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
      questions: normalize((resource.questions || []).join(" ")),
      aliases: normalize((resource.aliases || []).join(" ")),
      tags: normalize(resource.tags.join(" ")),
      useCases: normalize((resource.useCases || []).join(" ")),
      entities: normalize((resource.entities || []).join(" ")),
      topics: normalize(resource.topics.join(" ")),
      contentType: normalize(resource.contentType || ""),
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
      pinyinInitials: "",
      pinyinFull: "",
      pinyinReady: false,
      chineseBigrams: bigrams(text)
    };
  });
}

export function isPinyinSearchQuery(query: string): boolean {
  const candidate = compact(query.trim());
  return /^[a-z]+$/i.test(candidate) && candidate.length >= 2;
}

async function loadDefaultPinyin(): Promise<PinyinConverter | null> {
  if (!defaultPinyinLoader) {
    defaultPinyinLoader = import("pinyin-pro")
      .then((module) => module.pinyin as PinyinConverter)
      .catch(() => null);
  }
  return defaultPinyinLoader;
}

/**
 * 拼音索引只在用户首次输入疑似拼音时生成。调用方可以先使用同步搜索
 * 呈现标题、标签和中文二元组结果，加载完成后再重跑一次合并拼音结果。
 */
export async function hydratePinyinSearchIndex(
  index: LocalSearchIndexItem[],
  loader?: PinyinLoader
): Promise<boolean> {
  if (index.every((item) => item.pinyinReady)) return true;
  let convert: PinyinConverter | null = null;
  try {
    convert = loader ? await loader() : await loadDefaultPinyin();
  } catch {
    convert = null;
  }
  if (!convert) return false;

  for (const item of index) {
    if (item.pinyinReady) continue;
    const text = searchableText(item.fields);
    item.pinyinInitials = compact(
      convert(text, {
        pattern: "first",
        toneType: "none",
        type: "array",
        nonZh: "consecutive"
      }).join("")
    );
    item.pinyinFull = compact(
      convert(text, {
        toneType: "none",
        type: "array",
        nonZh: "consecutive"
      }).join("")
    );
    item.pinyinReady = true;
  }
  return true;
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

  // questions outranks title on purpose: it holds the phrasing people actually
  // use when trying to find a bookmark again, which the title rarely matches.
  scoreField("questions", 34, "可能的提问");
  scoreField("title", 30, "标题");
  scoreField("aliases", 26, "检索别名");
  scoreField("tags", 20, "标签");
  scoreField("useCases", 18, "使用场景");
  scoreField("entities", 17, "关键实体");
  scoreField("topics", 16, "主题");
  scoreField("contentType", 14, "内容类型");
  scoreField("summary", 12, "摘要");
  scoreField("note", 12, "备注");
  scoreField("folder", 8, "文件夹");
  scoreField("excerpt", 5, "正文摘录");
  scoreField("url", 3, "网址");

  const compactQuery = compact(normalizedQuery);
  if (isPinyinSearchQuery(compactQuery) && item.pinyinReady) {
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

export async function searchLocalResourcesWithPinyin(
  resources: ResourceRecord[],
  query: string,
  loader?: PinyinLoader
): Promise<SearchResult[]> {
  const index = buildLocalSearchIndex(resources);
  if (isPinyinSearchQuery(query)) {
    await hydratePinyinSearchIndex(index, loader);
  }
  return searchLocalIndex(index, query);
}

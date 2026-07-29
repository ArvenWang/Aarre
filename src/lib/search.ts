import type { ResourceRecord, SearchResult } from "./types";

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC");
}

export function searchLocalResources(
  resources: ResourceRecord[],
  query: string
): SearchResult[] {
  const terms = normalize(query)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (!terms.length) {
    return resources.map((resource) => ({ resource }));
  }

  return resources
    .map((resource) => {
      const fields = {
        title: normalize(resource.title),
        tags: normalize(resource.tags.join(" ")),
        summary: normalize(resource.summary),
        note: normalize(resource.userNote),
        excerpt: normalize(resource.contentExcerpt),
        url: normalize(resource.url)
      };

      let score = 0;
      for (const term of terms) {
        if (fields.title.includes(term)) score += 8;
        if (fields.tags.includes(term)) score += 6;
        if (fields.summary.includes(term)) score += 4;
        if (fields.note.includes(term)) score += 4;
        if (fields.excerpt.includes(term)) score += 2;
        if (fields.url.includes(term)) score += 1;
      }

      return { resource, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

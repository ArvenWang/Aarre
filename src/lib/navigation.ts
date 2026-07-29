export type ParsedNavigationInput =
  | { kind: "url"; url: string }
  | { kind: "search"; query: string };

const DIRECT_SCHEMES =
  /^(https?|chrome|edge|about|file|view-source):/i;
const DOMAIN_LIKE =
  /^(?:localhost(?::\d+)?|(?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#].*)?$/i;
const IPV4_LIKE =
  /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#].*)?$/;

export function parseNavigationInput(input: string): ParsedNavigationInput {
  const value = input.trim();
  if (!value) {
    return { kind: "search", query: "" };
  }

  if (DIRECT_SCHEMES.test(value)) {
    return { kind: "url", url: value };
  }

  if (DOMAIN_LIKE.test(value) || IPV4_LIKE.test(value)) {
    const local =
      value.toLowerCase().startsWith("localhost") ||
      IPV4_LIKE.test(value);
    return {
      kind: "url",
      url: `${local ? "http" : "https"}://${value}`
    };
  }

  return { kind: "search", query: value };
}

export function matchesNavigationText(
  query: string,
  ...values: Array<string | undefined>
): boolean {
  const terms = query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const haystack = values
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function highlightTextMatches(
  text: string,
  query: string,
): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const expression = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    const matchIndex = match.index;
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    const matchEnd = matchIndex + match[0].length;
    parts.push(
      <mark key={`${matchIndex}:${matchEnd}`}>
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    cursor = matchEnd;
  }
  if (!parts.length) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

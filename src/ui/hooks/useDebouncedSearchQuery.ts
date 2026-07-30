import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 140;

/**
 * 输入框继续使用即时 value；只有昂贵的索引扫描和书签树过滤读取这个值。
 * 清空必须同步恢复完整树，不能再等待一次计时器。
 */
export function useDebouncedSearchQuery(
  value: string,
  delay = SEARCH_DEBOUNCE_MS
): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (!value.trim()) {
      setDebounced("");
      return;
    }
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

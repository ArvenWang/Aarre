// @vitest-environment jsdom

import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEARCH_DEBOUNCE_MS,
  useDebouncedSearchQuery
} from "../src/ui/hooks/useDebouncedSearchQuery";

function Harness({
  onComputed
}: {
  onComputed: (query: string) => void;
}) {
  const [value, setValue] = useState("");
  const computed = useDebouncedSearchQuery(value);
  useEffect(() => {
    if (computed) onComputed(computed);
  }, [computed, onComputed]);
  return (
    <input
      aria-label="search"
      value={value}
      data-computed={computed}
      onInput={(event) => setValue(event.currentTarget.value)}
    />
  );
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useDebouncedSearchQuery", () => {
  it("keeps typing immediate, computes once after 140ms, and clears immediately", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const resources = Array.from(
      { length: 2_000 },
      (_, index) => `bookmark-${index}`
    );
    const onComputed = vi.fn((query: string) =>
      resources.filter((value) => value.includes(query))
    );
    await act(async () => root.render(<Harness onComputed={onComputed} />));
    const input = container.querySelector("input")!;

    await act(async () => {
      for (const value of [
        "p",
        "pi",
        "pin",
        "piny",
        "pinyi",
        "pinyin",
        "pinyins",
        "pinyinso",
        "pinyinsou",
        "pinyinsous"
      ]) {
        input.value = value;
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    });
    expect(input.value).toBe("pinyinsous");
    expect(input.dataset.computed).toBe("");

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(input.dataset.computed).toBe("");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(input.dataset.computed).toBe("pinyinsous");
    expect(onComputed).toHaveBeenCalledTimes(1);
    expect(onComputed).toHaveBeenCalledWith("pinyinsous");

    await act(async () => {
      input.value = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    expect(input.dataset.computed).toBe("");
    await act(async () => root.unmount());
  });
});

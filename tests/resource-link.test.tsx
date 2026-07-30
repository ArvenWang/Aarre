// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceLink } from "../src/ui/manager/components/ResourceLink";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ResourceLink", () => {
  it("routes an ordinary left click through Aarre", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onOpenResource = vi.fn();
    await act(async () => {
      root.render(
        <ResourceLink
          url="https://example.com/article"
          onOpenResource={onOpenResource}
        >
          Example
        </ResourceLink>
      );
    });

    const anchor = container.querySelector("a")!;
    const dispatched = anchor.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0
      })
    );

    expect(dispatched).toBe(false);
    expect(onOpenResource).toHaveBeenCalledWith(
      "https://example.com/article"
    );
    await act(async () => root.unmount());
  });

  it("keeps modifier clicks native for new-tab workflows", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onOpenResource = vi.fn();
    await act(async () => {
      root.render(
        <ResourceLink
          url="https://example.com/article"
          onOpenResource={onOpenResource}
        >
          Example
        </ResourceLink>
      );
    });

    const anchor = container.querySelector("a")!;
    const dispatched = anchor.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: true
      })
    );

    expect(dispatched).toBe(true);
    expect(onOpenResource).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

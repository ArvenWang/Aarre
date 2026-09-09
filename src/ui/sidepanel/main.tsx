import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SidePanelApp } from "./SidePanelApp";
import { Button } from "@/ui/components/ui/button";
import { initializeTheme } from "../../lib/theme";
import "../styles-sidepanel.css";

import { SidePanelErrorBoundary } from "./error-boundary";

async function bootstrap(): Promise<void> {
  initializeTheme();
  document.documentElement.dataset.density = "compact";
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") !== "0"
  ) {
    document.documentElement.dataset.sidepanelPreview = "true";
    const { installSidePanelPreview } = await import("./preview");
    installSidePanelPreview();
  }

  const runtime = globalThis as typeof globalThis & {
    __aarreSidePanelRoot?: Root;
  };
  const root =
    runtime.__aarreSidePanelRoot ||
    createRoot(document.getElementById("root")!);
  runtime.__aarreSidePanelRoot = root;
  root.render(
    <StrictMode>
      <SidePanelErrorBoundary>
        <SidePanelApp />
      </SidePanelErrorBoundary>
    </StrictMode>,
  );
  window.requestAnimationFrame(() => {
    performance.mark("aarre-react-first-commit");
    document.documentElement.dataset.aarreReactCommitted = "true";
  });
}

void bootstrap();

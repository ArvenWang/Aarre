import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ManagerApp } from "./ManagerApp";
import { initializeTheme } from "../../lib/theme";
import "../styles.css";

async function bootstrap(): Promise<void> {
  initializeTheme();
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") !== "0"
  ) {
    const { installSidePanelPreview } = await import(
      "../sidepanel/preview"
    );
    installSidePanelPreview();
  }
  const runtime = globalThis as typeof globalThis & {
    __aarreManagerRoot?: Root;
  };
  const root =
    runtime.__aarreManagerRoot ||
    createRoot(document.getElementById("root")!);
  runtime.__aarreManagerRoot = root;
  root.render(
    <StrictMode>
      <ManagerApp />
    </StrictMode>
  );
}

void bootstrap();

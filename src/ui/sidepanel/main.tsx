import {
  Component,
  StrictMode,
  type ErrorInfo,
  type ReactNode
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { SidePanelApp } from "./SidePanelApp";
import "../styles.css";

class SidePanelErrorBoundary extends Component<
  { children: ReactNode },
  { message: string }
> {
  state = { message: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      message:
        error instanceof Error ? error.message : "侧边栏暂时无法打开"
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Aarre side panel failed", error, info);
  }

  render() {
    if (!this.state.message) return this.props.children;

    return (
      <main className="sidepanel-recovery">
        <strong>Aarre 暂时无法打开</strong>
        <p>{this.state.message}</p>
        <button type="button" onClick={() => chrome.runtime.reload()}>
          重新加载 Aarre
        </button>
      </main>
    );
  }
}

async function bootstrap(): Promise<void> {
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "1"
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
    </StrictMode>
  );
}

void bootstrap();

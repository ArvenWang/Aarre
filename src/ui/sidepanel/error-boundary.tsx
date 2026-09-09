import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/ui/components/ui/button";
export class SidePanelErrorBoundary extends Component<
  { children: ReactNode },
  { message: string }
> {
  state = { message: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      message: error instanceof Error ? error.message : "侧边栏暂时无法打开",
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
        <Button
          type="button"
          variant="primary"
          onClick={() => chrome.runtime.reload()}
        >
          重新加载 Aarre
        </Button>
      </main>
    );
  }
}

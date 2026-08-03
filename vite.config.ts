import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  build: {
    target: "chrome116",
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        manager: resolve(__dirname, "manager.html"),
        privacy: resolve(__dirname, "privacy.html"),
        iconProcessor: resolve(__dirname, "icon-processor.html"),
        background: resolve(__dirname, "src/extension/background.ts")
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/pinyin-pro/")) return "pinyin-search";
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/")
          ) return "react-vendor";
          if (
            id.includes("/node_modules/@radix-ui/") ||
            id.includes("/node_modules/@base-ui/")
          ) return "ui-vendor";
          if (
            id.includes("/node_modules/react-markdown/") ||
            id.includes("/node_modules/remark-") ||
            id.includes("/node_modules/micromark")
          ) return "markdown";
          return undefined;
        },
        entryFileNames(chunkInfo) {
          return chunkInfo.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "chrome116",
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        manager: resolve(__dirname, "manager.html"),
        privacy: resolve(__dirname, "privacy.html"),
        background: resolve(__dirname, "src/extension/background.ts")
      },
      output: {
        manualChunks(id) {
          return id.includes("/node_modules/pinyin-pro/")
            ? "pinyin-search"
            : undefined;
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

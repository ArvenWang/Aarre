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
    // 页面端继续使用原生 ESM 动态导入；关闭额外依赖预加载，避免无意义
    // 的脚本预取。MV3 后台由 vite.background.config.ts 单独构建。
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        manager: resolve(__dirname, "manager.html"),
        privacy: resolve(__dirname, "privacy.html"),
        iconProcessor: resolve(__dirname, "icon-processor.html")
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
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

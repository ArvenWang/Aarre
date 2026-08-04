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
    // 只预加载页面入口静态依赖；React.lazy 产生的动态 chunk 不会被预取。
    // MV3 后台由 vite.background.config.ts 单独构建。
    modulePreload: true,
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
            id.includes("/node_modules/react/jsx-runtime") ||
            id.includes("/node_modules/react/jsx-dev-runtime") ||
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/")
          ) return "react-vendor";
          if (
            id.includes("/node_modules/@radix-ui/") ||
            id.includes("/node_modules/@base-ui/")
          ) return "ui-vendor";
          return undefined;
        },
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Chrome 扩展 MV3 Service Worker 不支持动态 import()。后台必须独立构建
 * 并内联所有动态模块；页面入口仍由主 Vite 配置分包，不受这里影响。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  build: {
    target: "chrome116",
    emptyOutDir: false,
    modulePreload: false,
    minify: "oxc",
    // 单文件是 Chrome MV3 的兼容性要求，不应提示改回不受支持的 import()。
    chunkSizeWarningLimit: 750,
    // library 模式不会注入面向网页 client 的 modulepreload 助手；否则即使
    // code splitting 已关闭，死代码中仍会残留 document/window。
    lib: {
      entry: resolve(__dirname, "src/extension/background.ts"),
      formats: ["es"],
      fileName: () => "background.js"
    },
    rolldownOptions: {
      output: {
        codeSplitting: false,
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// surface-classes.ts 里的类名通过查找表间接引用。Tailwind 的
// source(none) 模式不会扫描未声明文件，遗漏会让所有弹层失去背景。
describe("tailwind @source coverage", () => {
  for (const entry of [
    "src/ui/styles-sidepanel.css",
    "src/ui/styles-manager.css",
  ]) {
    it(`${entry} 覆盖 surface-classes.ts`, () => {
      const css = readFileSync(entry, "utf8");
      expect(css).toContain('@source "../lib/surface-classes.ts"');
    });
  }
});

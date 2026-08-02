import assert from "node:assert/strict";
import test from "node:test";
import {
  renderHomePage,
  renderPrivacyPage,
  renderTermsPage
} from "../src/public-pages.js";

const baseUrl = "https://sync.example.test";

test("public pages are self-contained, canonical and free of executable scripts", () => {
  const pages = [
    [renderHomePage(baseUrl), "https://sync.example.test/"],
    [renderPrivacyPage(baseUrl), "https://sync.example.test/privacy"],
    [renderTermsPage(baseUrl), "https://sync.example.test/terms"]
  ] as const;

  for (const [html, canonical] of pages) {
    assert.match(html, /^<!doctype html>/);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical.replaceAll(".", "\\.")}">`));
    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /https?:\/\/[^"']+\.(?:js|css)/i);
    assert.match(html, /href="https:\/\/sync\.example\.test\/privacy"/);
    assert.match(html, /href="https:\/\/sync\.example\.test\/terms"/);
  }
});

test("privacy and terms describe the production data boundaries", () => {
  const home = renderHomePage(baseUrl);
  const privacy = renderPrivacyPage(baseUrl);
  const terms = renderTermsPage(baseUrl);

  assert.match(home, /<h1>Aarre<\/h1>/);
  assert.match(home, /Aarre is a Chrome bookmark extension/);
  assert.match(home, /<title>Aarre<\/title>/);
  assert.match(home, /What is Aarre\?/);
  assert.match(home, /Why does Aarre use Google Sign-In\?/);
  for (const expected of [
    "云端默认关闭",
    "API Key",
    "受保护资源",
    "SSE-COS AES-256",
    "香港",
    "新加坡",
    "7 天内删除",
    "English summary"
  ]) {
    assert.match(privacy, new RegExp(expected));
  }
  assert.match(terms, /你保留书签、备注、标签、封面和快照等内容的权利/);
  assert.match(terms, /云端备份不能替代 Chrome Sync/);
});

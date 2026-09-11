/**
 * 资料详情页 · 要点抽取解析 单测（docs/library-detail-page-design-2026-09.md §11.1）。
 *
 * 运行：npm run test:library
 *
 * 覆盖（TC-KP-01）：
 *  1) 合规响应 → 原样返回；
 *  2) point 超 60 字 → 裁剪；quote 超 200 字 → 裁剪；
 *  3) 缺 quote 的条目 → 丢弃（无原文出处的要点不入库，E3 诚实降级）；
 *  4) 重复 point → 去重；超过 5 条 → 截断到 5；
 *  5) 全部不合规 / 非对象响应 → 抛类型化错误（不静默返回空）；
 *  6) 章正文为空 → 执行器抛错（不发起 AI 调用）。
 */
import assert from "node:assert/strict";
import {
  buildKeyPointMessages,
  extractKeyPointsWithAi,
  parseKeyPointDrafts,
  PIPELINE_LIMITS,
} from "../src/ai/pipelines.ts";
import { AiProviderError } from "../src/ai/types.ts";
import type { AIProvider } from "../src/ai/types.ts";

const results: string[] = [];
let failures = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 假 provider：只用于触发「未配置 / 空正文」这两条不依赖网络的路径。 */
const offlineProvider: AIProvider = {
  kind: "builtin",
  isConfigured: () => false,
  chat: () => Promise.reject(new Error("不应被调用")),
  generateAssessment: () => Promise.reject(new Error("不应被调用")),
  evaluateAnswer: () => Promise.reject(new Error("不应被调用")),
};

await check("合规响应 → 原样返回", () => {
  const out = parseKeyPointDrafts({
    points: [
      { point: "向量化把文本映射为向量", quote: "向量化把文本映射为向量。" },
      { point: "嵌入是稠密表示", quote: "嵌入是稠密表示。" },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].point, "向量化把文本映射为向量");
  assert.equal(out[1].quote, "嵌入是稠密表示。");
});

await check("超长裁剪：point → 60 字，quote → 200 字", () => {
  const out = parseKeyPointDrafts({
    points: [{ point: "甲".repeat(120), quote: "乙".repeat(500) }],
  });
  assert.equal(out[0].point.length, PIPELINE_LIMITS.keyPointMaxChars);
  assert.equal(out[0].quote.length, PIPELINE_LIMITS.keyPointQuoteMaxChars);
});

await check("缺 quote / 空 quote → 丢弃该条（无出处不入库）", () => {
  const out = parseKeyPointDrafts({
    points: [
      { point: "有出处的要点", quote: "原文摘录" },
      { point: "没有 quote 的要点" },
      { point: "空 quote 的要点", quote: "   " },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].point, "有出处的要点");
});

await check("重复 point → 去重；超过 5 条 → 截断到 5", () => {
  const dup = parseKeyPointDrafts({
    points: [
      { point: "同一条", quote: "a" },
      { point: "同一条", quote: "b" },
    ],
  });
  assert.equal(dup.length, 1);

  const many = parseKeyPointDrafts({
    points: Array.from({ length: 9 }, (_, i) => ({
      point: `要点 ${i}`,
      quote: `原文 ${i}`,
    })),
  });
  assert.equal(many.length, 5);
});

await check("全部不合规 → 抛 AiProviderError（不静默返回空）", () => {
  assert.throws(
    () => parseKeyPointDrafts({ points: [{ point: "", quote: "" }] }),
    (err: unknown) => err instanceof AiProviderError,
  );
  assert.throws(
    () => parseKeyPointDrafts({ points: [] }),
    (err: unknown) => err instanceof AiProviderError,
  );
});

await check("非对象响应 → 抛 AiProviderError", () => {
  assert.throws(
    () => parseKeyPointDrafts([{ point: "x", quote: "y" }]),
    (err: unknown) => err instanceof AiProviderError,
  );
});

await check("buildKeyPointMessages：提示词含章标题与正文", () => {
  const msgs = buildKeyPointMessages({ chapterTitle: "第一章 概述", text: "正文内容" });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs[1].content.includes("第一章 概述"), "user 消息应带章标题");
  assert.ok(msgs[1].content.includes("正文内容"), "user 消息应带正文");
});

await check("空正文 → 执行器直接抛错，不发起 AI 调用", async () => {
  await assert.rejects(
    () => extractKeyPointsWithAi(offlineProvider, { chapterTitle: "t", text: "   " }),
    (err: unknown) => err instanceof AiProviderError,
  );
});

console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\n[library-keypoint] ${results.length - failures}/${results.length} 通过`);
  process.exit(1);
}
console.log(`\n[library-keypoint] ${results.length}/${results.length} 通过`);

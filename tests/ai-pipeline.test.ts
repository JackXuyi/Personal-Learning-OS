/**
 * AI 管道传输与解析 单测（docs/ai-analysis-summary-fix-design-2026-09.md §11）。
 *
 * 运行：npm run test:ai
 *
 * 覆盖：
 *  1) chatJson 把 temperature / jsonMode 真实传给 provider —— 根因回归守门
 *     （builtin 曾静默丢弃 temperature，导致 JSON 管道在本地模型上全失败）；
 *  2) repairTruncatedJson：截断 JSON 只保留完整元素并补齐闭合符；
 *  3) extractJson：截断输入走修复而不是直接抛错（含 ```json 围栏）；
 *  4) 截断在第 1 条元素中间 → 修复为空容器（绝不伪造半条）；
 *  5) 裸词垃圾 / 结构错乱 → 不可修复（返回 undefined，保持抛错）；
 *  6) 合法 JSON（含字符串内括号）不经过修复路径。
 */
import assert from "node:assert/strict";
import { chatJson, extractJson } from "../src/ai/pipelines.ts";
import { repairTruncatedJson } from "../src/ai/json-repair.ts";
import type { AIProvider, ChatInput } from "../src/ai/types.ts";

const results: string[] = [];
let failures = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures++;
    results.push(`✗ ${name}\n  ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 记录最后一次 ChatInput 的假 provider（不触网、不 invoke）。 */
function recordingProvider(content = '{"ok":true}'): {
  provider: AIProvider;
  last: () => ChatInput | undefined;
} {
  let last: ChatInput | undefined;
  const provider: AIProvider = {
    kind: "builtin",
    isConfigured: () => true,
    chat: async (input) => {
      last = input;
      return { content };
    },
    generateAssessment: () => Promise.reject(new Error("不应被调用")),
    evaluateAnswer: () => Promise.reject(new Error("不应被调用")),
  };
  return { provider, last: () => last };
}

await check("chatJson 把 temperature/jsonMode 传给 provider（根因回归守门）", async () => {
  const { provider, last } = recordingProvider();
  await chatJson(provider, [{ role: "user", content: "x" }], 0.2);
  assert.equal(last()?.temperature, 0.2, "temperature 必须透传（builtin 曾丢弃）");
  assert.equal(last()?.jsonMode, true, "jsonMode 必须声明（builtin 据此启用近贪心预设）");
});

await check("repairTruncatedJson：截断 JSON 只保留完整元素并补齐闭合符", () => {
  const truncated = '{"units":[{"title":"A","kind":"concept","summary":"sa"},{"title":"B","kin';
  const repaired = repairTruncatedJson(truncated);
  assert.ok(repaired, "截断输入应可修复");
  assert.deepEqual(
    JSON.parse(repaired!),
    { units: [{ title: "A", kind: "concept", summary: "sa" }] },
    "只保留第 1 条完整元素",
  );
});

await check("extractJson 对截断输入走修复而不是直接抛错（含围栏）", () => {
  const out = extractJson('```json\n{"units":[{"title":"A"},{"title":"B"');
  assert.deepEqual(out, { units: [{ title: "A" }] });
});

await check("截断在第 1 条中间 → 修复为空容器，不伪造半条", () => {
  const out = extractJson('{"units":[{"title":"A","kin');
  assert.deepEqual(out, { units: [] });
});

await check("裸词垃圾 / 结构错乱 → 不可修复（保持抛错）", () => {
  assert.equal(repairTruncatedJson("{ broken"), undefined, "裸词残留不是截断");
  assert.equal(repairTruncatedJson('{"a":1]]'), undefined, "括号交叉不修复");
  assert.throws(() => extractJson("{ broken"), undefined, "extractJson 对不可修复输入抛错");
});

await check("合法 JSON（含字符串内括号）不走修复路径", () => {
  assert.deepEqual(extractJson('{"units":[{"title":"A"}]}'), { units: [{ title: "A" }] });
  assert.deepEqual(
    extractJson('{"text":"包含 } 与 ] 的字符串","n":1}'),
    { text: "包含 } 与 ] 的字符串", n: 1 },
    "字符串内的闭合符不得干扰解析",
  );
});

console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\n[ai-pipeline] ${results.length - failures}/${results.length} 通过`);
  process.exit(1);
}
console.log(`\n[ai-pipeline] ${results.length}/${results.length} 通过`);

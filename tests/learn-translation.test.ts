/**
 * 章正文 AI 翻译 —— 目标语言解析 / 尺寸口径 / 分块不变式 / 失败语义 / 渐进回调 /
 * 指纹缓存 / 整库任务 单测
 * （docs/learn-ai-translation-design-2026-10.md §12 TC-UC01~03 + §14.12 T28）。
 *
 * 运行：`npm run test:translation`
 *
 * 零真实网络 / 零真实模型 / 零真实磁盘：AI 用假 provider 记账调用次数，
 * 存储用假 StorageAdapter（只实现整库任务真正用到的那几个方法）。
 * **不 import 任何 `.tsx`**（strip-types 不支持 JSX）；zustand store 是纯 TS，
 * 可以 import（`useTranslationIndexStore` 需要清场）。
 */
import assert from "node:assert/strict";
import type { AIProvider, ChatInput, ChatOutput } from "../src/ai/types.ts";
import { AiProviderError } from "../src/ai/types.ts";
import { TEMPERATURE } from "../src/ai/pipeline-core.ts";
import { planTextBlocks } from "../src/ai/text-blocks.ts";
import {
  buildTranslationMessages,
  translateText,
  translationConcurrencyOf,
} from "../src/ai/translation.ts";
import { ANNOTATION_LIMITS } from "../src/domain/annotation.ts";
import {
  TRANSLATION_LANG_EN,
  TRANSLATION_LIMITS,
  TRANSLATION_TARGETS,
  bodyFingerprint,
  isTranslationTarget,
  resolveTranslationTarget,
  translationKeyOf,
} from "../src/domain/translation.ts";
import type { Chapter, SourceDocument, TranslationIndexRow, TranslationRecord } from "../src/domain/index.ts";
import type { StorageAdapter } from "../src/storage/types.ts";
import {
  translateChapterBody,
  translateSnippet,
} from "../src/features/learn/translation-service.ts";
import { translateLibrary } from "../src/features/learn/translation-library-service.ts";
import { useTranslationIndexStore } from "../src/stores/useTranslationIndexStore.ts";

const results: string[] = [];
let failures = 0;

/**
 * 待结算的用例。
 *
 * ⚠️ 本文件大量用例是 async（每个 `translateChapterBody` / `translateLibrary`
 * 都要 await）。若像同步用例那样「`void check(...)` 之后直接打印汇总」，
 * 汇总跑在**所有断言之前** —— 结果数组是空的、`failures` 恒 0，
 * 「全部通过」无条件打印。那等于没有门禁：改坏了也照绿。
 * 所以必须把 promise 收齐、末尾 `await Promise.all(...)` 再结算。
 */
const pending: Promise<void>[] = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 登记一条用例（不等待：并行跑，末尾统一结算）。 */
function it(name: string, fn: () => Promise<void> | void): void {
  pending.push(check(name, fn));
}

/* ---------------- fixtures ---------------- */

/** 无空行的正文：分块只能硬切，便于断言「块数 = ceil(len / blockChars)」。 */
function flatBody(len: number): string {
  return "a".repeat(len);
}

/** 由尺寸常量反推期望块数 —— **不写死数字**（否则改块尺寸就一片红）。 */
function expectedBlocks(len: number): number {
  return Math.ceil(len / TRANSLATION_LIMITS.blockChars);
}

/**
 * 假 provider：`reply(i, input)` 决定第 i 次调用返回什么（返回 `Error` 即抛错）。
 * 默认返回固定译文「译」。
 */
function mockProvider(opts: {
  configured?: boolean;
  kind?: AIProvider["kind"];
  reply?: (i: number, input: ChatInput) => string | Error;
} = {}): { provider: AIProvider; calls: ChatInput[] } {
  const calls: ChatInput[] = [];
  const provider: AIProvider = {
    kind: opts.kind ?? "custom",
    isConfigured: () => opts.configured ?? true,
    chat: async (input: ChatInput): Promise<ChatOutput> => {
      const i = calls.length;
      calls.push(input);
      const r = opts.reply ? opts.reply(i, input) : "译";
      if (r instanceof Error) throw r;
      return { content: r };
    },
  };
  return { provider, calls };
}

/** 未配置的 provider：任何调用都应被阻断门拦住（`chat` 计数会暴露漏网）。 */
function unconfiguredProvider(): { provider: AIProvider; calls: ChatInput[] } {
  return mockProvider({ configured: false });
}

/* ---------------- 目标语言 ---------------- */

it("TC-UC01-01 auto → 界面语言（zh）", () => {
  assert.equal(resolveTranslationTarget("auto", "zh"), "zh");
});

it("TC-UC01-02 auto → 界面语言（en）", () => {
  assert.equal(resolveTranslationTarget("auto", "en"), "en");
});

it("TC-UC01-03 显式目标覆盖界面语言", () => {
  assert.equal(resolveTranslationTarget("ja", "zh"), "ja");
  assert.equal(resolveTranslationTarget("ru", "en"), "ru");
});

it("TC-EDGE-06 白名单判型（拒绝脏持久化值）", () => {
  assert.equal(isTranslationTarget("ja"), true);
  assert.equal(isTranslationTarget("auto"), true);
  assert.equal(isTranslationTarget("jp"), false); // 常见手误码
  assert.equal(isTranslationTarget(undefined), false);
  assert.equal(isTranslationTarget(1), false);
});

it("提示词语言名与目标表一一对应", () => {
  const langs = TRANSLATION_TARGETS.filter((t) => t !== "auto");
  assert.deepEqual(Object.keys(TRANSLATION_LANG_EN).sort(), [...langs].sort());
  for (const l of langs) assert.ok(TRANSLATION_LANG_EN[l].length > 0);
});

/* ---------------- 尺寸口径 ---------------- */

it("TC-UC01-04a 尺寸三项是显式常量（700 / 40 / 24 000）", () => {
  assert.equal(TRANSLATION_LIMITS.blockChars, 700);
  assert.equal(TRANSLATION_LIMITS.blockMax, 40);
  assert.equal(TRANSLATION_LIMITS.bodyMaxChars, 24_000);
});

it("TC-UC01-04b 正文上限**不再**由块尺寸派生（解耦不可回退）", () => {
  // 700 × 40 = 28 000 ≠ 24 000。这条断言存在的意义：若有人把 BODY_MAX_CHARS
  // 「顺手修正」成乘机，上限会静默放宽 4 000 字（≈ 2 分钟等待）。
  assert.notEqual(
    TRANSLATION_LIMITS.bodyMaxChars,
    TRANSLATION_LIMITS.blockChars * TRANSLATION_LIMITS.blockMax,
  );
  // 但两条约束的**先后**必须是正文上限先触发：否则 blockMax 会先夹住块数，
  // 超长正文被「算术均分」硬翻出来，而不是被拒绝。
  assert.ok(
    TRANSLATION_LIMITS.bodyMaxChars <= TRANSLATION_LIMITS.blockChars * TRANSLATION_LIMITS.blockMax,
    "正文上限必须先于块数上限触发",
  );
});

it("TC-UC01-05 短章单块（blockChars 内不做二次切分）", () => {
  const len = TRANSLATION_LIMITS.blockChars - 1;
  const blocks = planTextBlocks({
    text: flatBody(len),
    chunkChars: TRANSLATION_LIMITS.blockChars,
    maxChunks: TRANSLATION_LIMITS.blockMax,
  });
  assert.equal(blocks.length, 1);
  assert.deepEqual([blocks[0].start, blocks[0].end], [0, len]);
});

it("TC-UC01-06 分块覆盖全文（非整除长度也不留尾巴）", () => {
  // 刻意取非整除：整除长度的边界错误（漏末块 / 末块过短）会被整除掩盖。
  const len = TRANSLATION_LIMITS.blockChars * 5 + 137;
  const text = flatBody(len);
  const blocks = planTextBlocks({
    text,
    chunkChars: TRANSLATION_LIMITS.blockChars,
    maxChunks: TRANSLATION_LIMITS.blockMax,
  });
  assert.ok(blocks.length <= TRANSLATION_LIMITS.blockMax, `块数 ${blocks.length} 超上限`);
  assert.equal(blocks.length, expectedBlocks(len));
  assert.equal(blocks[0].start, 0);
  assert.equal(blocks[blocks.length - 1].end, len);
  for (let i = 1; i < blocks.length; i++) {
    assert.equal(blocks[i].start, blocks[i - 1].end, "相邻块必须首尾相接");
  }
  assert.equal(blocks.map((b) => text.slice(b.start, b.end)).join(""), text);
});

it("TC-UC01-15 上限处刚好装下（24 000 字）", () => {
  const text = flatBody(TRANSLATION_LIMITS.bodyMaxChars);
  const blocks = planTextBlocks({
    text,
    chunkChars: TRANSLATION_LIMITS.blockChars,
    maxChunks: TRANSLATION_LIMITS.blockMax,
  });
  // 关键：24 000 字**不能**撞到 blockMax（撞到就说明上限口径又漂了）。
  assert.ok(
    blocks.length < TRANSLATION_LIMITS.blockMax,
    `块数 ${blocks.length} 已达到 blockMax —— 正文上限本该先触发`,
  );
  assert.equal(blocks.map((b) => text.slice(b.start, b.end)).join(""), text);
});

/* ---------------- 提示词构造 ---------------- */

it("提示词：system 带目标语言，user 带正文", () => {
  const msgs = buildTranslationMessages({ target: "ja", text: "hello world" });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs[0].content.includes("Japanese"));
  assert.ok(msgs[0].content.includes("Markdown"), "必须要求保留 Markdown 结构");
  assert.equal(msgs[1].role, "user");
  assert.ok(msgs[1].content.includes("hello world"));
  // 单块不带「位置」提示（否则模型会以为还有别的段）
  assert.ok(!msgs[1].content.includes("【位置】"));
});

it("提示词：多块带 k/K 位置感，上下文可选注入", () => {
  const single = buildTranslationMessages({ target: "en", text: "x", blockIndex: 1, blockTotal: 4 });
  assert.ok(single[1].content.includes("2/4"));
  const withCtx = buildTranslationMessages({
    target: "zh",
    text: "x",
    context: { title: "Attention", keyPoints: ["自注意力", "多头"] },
  });
  assert.ok(withCtx[1].content.includes("【本章标题】Attention"));
  assert.ok(withCtx[1].content.includes("· 自注意力"));
  const noCtx = buildTranslationMessages({ target: "zh", text: "x" });
  assert.ok(!noCtx[1].content.includes("【本章标题】"));
});

/* ---------------- 服务层门槛 ---------------- */

it("TC-UC01-07 超长拒绝（provider 零调用）", async () => {
  const { provider, calls } = mockProvider();
  const r = await translateChapterBody({
    body: flatBody(TRANSLATION_LIMITS.bodyMaxChars + 1),
    target: "zh",
    provider,
  });
  assert.equal(r.status, "error");
  if (r.status === "error") assert.equal(r.errorKind, "too-long");
  assert.equal(calls.length, 0);
});

it("TC-UC01-08 空正文", async () => {
  const { provider, calls } = mockProvider();
  const r = await translateChapterBody({ body: "   ", target: "zh", provider });
  assert.equal(r.status, "error");
  if (r.status === "error") assert.equal(r.errorKind, "no-body");
  assert.equal(calls.length, 0);
});

it("TC-UC01-09 AI 阻断门（未配置 → 零调用）", async () => {
  const { provider, calls } = unconfiguredProvider();
  const r = await translateChapterBody({ body: "一段正文", target: "zh", provider });
  assert.equal(r.status, "error");
  if (r.status === "error") assert.equal(r.errorKind, "no-ai");
  assert.equal(calls.length, 0, "未配置时不得发起任何调用");
});

/* ---------------- 失败语义 ---------------- */

it("TC-UC01-10 全块失败 → 判失败（parse）", async () => {
  const { provider } = mockProvider({
    reply: () => new AiProviderError("request-failed", "boom"),
  });
  const r = await translateChapterBody({ body: flatBody(1_500), target: "zh", provider });
  assert.equal(r.status, "error");
  if (r.status === "error") assert.equal(r.errorKind, "parse");
});

it("TC-UC01-11 部分块失败 → 跳过并计数，不写占位", async () => {
  // 4 块：第 2、4 块抛错
  const body = flatBody(TRANSLATION_LIMITS.blockChars * 3 + 100);
  const total = expectedBlocks(body.length);
  assert.equal(total, 4);
  const { provider, calls } = mockProvider({
    reply: (i) => (i === 1 || i === 3 ? new AiProviderError("request-failed", "boom") : "译"),
  });
  const r = await translateChapterBody({ body, target: "zh", provider });
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.blocks, total);
  assert.equal(r.skippedBlocks, 2);
  assert.equal(r.cancelled, false);
  assert.equal(calls.length, total, "失败的块也必须真的尝试过");
  // 只剩 2 段译文，块间用空行拼接；没有任何「占位文本」
  assert.equal(r.text, "译\n\n译");
  assert.ok(!r.text.includes("未翻译"));
  assert.ok(!r.text.includes("..."));
});

it("TC-UC01-12 空输出块按失败计（不写入空串占位）", async () => {
  const body = flatBody(TRANSLATION_LIMITS.blockChars * 3);
  const { provider } = mockProvider({ reply: (i) => (i === 0 ? "" : "译") });
  const r = await translateChapterBody({ body, target: "zh", provider });
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.blocks, 3);
  assert.equal(r.skippedBlocks, 1);
  assert.equal(r.text, "译\n\n译");
});

it("短章单块：一次调用 + 温度取翻译档", async () => {
  const { provider, calls } = mockProvider();
  const r = await translateChapterBody({ body: "短正文", target: "zh", provider });
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.blocks, 1);
  assert.equal(r.skippedBlocks, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].temperature, TEMPERATURE.translation);
  // 纯文本通道：不得声明 jsonMode（否则 builtin 会走紧采样 + 我们还要解析 JSON）
  assert.equal(calls[0].jsonMode, undefined);
});

it("块进度回调：done 是**完成数**且从 1 递增（不是发起数）", async () => {
  const seen: string[] = [];
  const { provider } = mockProvider();
  const body = flatBody(TRANSLATION_LIMITS.blockChars * 3);
  const r = await translateChapterBody({
    body,
    target: "zh",
    provider,
    onProgress: (done, total) => seen.push(`${done}/${total}`),
  });
  assert.equal(r.status, "ok");
  assert.deepEqual(seen, ["1/3", "2/3", "3/3"]);
});

/**
 * 首版把 `onBlock` 报在块**发起前** ⇒ 进度到 100% 后还要再等一整块（700 字约
 * 25 秒），用户以为卡死。这条用例锁住「last progress 必然等于 total」——
 * 也就锁住了「不会出现 100% 之后还空等」。
 */
it("块进度回调：最后一条必为 total/total", async () => {
  const seen: [number, number][] = [];
  const { provider } = mockProvider();
  const body = flatBody(TRANSLATION_LIMITS.blockChars * 2 + 10);
  await translateChapterBody({
    body,
    target: "zh",
    provider,
    onProgress: (done, total) => seen.push([done, total]),
  });
  const last = seen[seen.length - 1];
  assert.equal(last[0], last[1]);
});

/* ---------------- 渐进上屏（v6） ---------------- */

it("onBlockDone：index 从 0 起、只报成功块", async () => {
  const seen: [number, string][] = [];
  const { provider } = mockProvider({
    reply: (i) => (i === 1 ? new AiProviderError("request-failed", "boom") : `译${i}`),
  });
  const body = flatBody(TRANSLATION_LIMITS.blockChars * 3);
  const r = await translateChapterBody({
    body,
    target: "zh",
    provider,
    onBlockDone: (index, text) => seen.push([index, text]),
  });
  assert.equal(r.status, "ok");
  assert.deepEqual(seen, [
    [0, "译0"],
    [2, "译2"],
  ]);
});

it("onBlockDone 与 onBlock 的分工：上屏先于进度", async () => {
  const order: string[] = [];
  const { provider } = mockProvider();
  const body = flatBody(TRANSLATION_LIMITS.blockChars * 2 + 10);
  await translateChapterBody({
    body,
    target: "zh",
    provider,
    onBlockDone: (i) => order.push(`text${i}`),
    onProgress: (done) => order.push(`progress${done}`),
  });
  assert.deepEqual(order, ["text0", "progress1", "text1", "progress2", "text2", "progress3"]);
});

/* ---------------- 取消（v6） ---------------- */

it("取消只在块间生效：已完成块保留、cancelled=true", async () => {
  const controller = new AbortController();
  const { provider, calls } = mockProvider({
    reply: (i) => {
      // 第 2 块跑完时喊停 ⇒ 第 3 块起不再发起
      if (i === 1) controller.abort();
      return "译";
    },
  });
  const body = flatBody(TRANSLATION_LIMITS.blockChars * 3);
  const r = await translateChapterBody({ body, target: "zh", provider, signal: controller.signal });
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.cancelled, true);
  assert.equal(calls.length, 2, "第 3 块不该发起");
  assert.equal(r.text, "译\n\n译");
});

it("取消导致的块失败不记 skip（用户喊停不等于翻不出来）", async () => {
  const controller = new AbortController();
  const { provider } = mockProvider({
    reply: (i) => {
      if (i === 1) {
        controller.abort();
        return new AiProviderError("request-failed", "aborted");
      }
      return "译";
    },
  });
  const r = await translateChapterBody({
    body: flatBody(TRANSLATION_LIMITS.blockChars * 3),
    target: "zh",
    provider,
    signal: controller.signal,
  });
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.cancelled, true);
  assert.equal(r.skippedBlocks, 0, "取消不该被计成「这段翻不出来」");
});

it("开跑前已取消 → 零调用即失败", async () => {
  const controller = new AbortController();
  controller.abort();
  const { provider, calls } = mockProvider();
  const r = await translateChapterBody({
    body: "一段正文",
    target: "zh",
    provider,
    signal: controller.signal,
  });
  assert.equal(r.status, "error");
  assert.equal(calls.length, 0);
});

/* ---------------- 并发度 ---------------- */

it("并发度：builtin 恒 1（sidecar 是全局串行临界区）", () => {
  assert.equal(translationConcurrencyOf("builtin"), 1);
});

it("并发度：HTTP provider 一致为 3", () => {
  for (const kind of ["qwen", "deepseek", "glm", "kimi", "openai", "anthropic", "gemini", "custom"] as const) {
    assert.equal(translationConcurrencyOf(kind), 3, `${kind} 应为 3`);
  }
  // Ollama / LM Studio / llama.cpp 也是 HTTP，但本地单实例会自己排队 ——
  // 并发本身不额外制造失败面，故同档。这里锁住「它们不属于 builtin 分支」。
  assert.equal(translationConcurrencyOf("ollama"), 3);
});

/* ---------------- 原文指纹 ---------------- */

it("指纹：同文本稳定、空串有定值", () => {
  const t = "x".repeat(500);
  assert.equal(bodyFingerprint(t), bodyFingerprint(t));
  assert.equal(bodyFingerprint(""), "0::");
});

it("指纹：长度变化必不等", () => {
  assert.notEqual(bodyFingerprint("abc"), bodyFingerprint("abcd"));
});

it("指纹：首 / 中 / 尾任一变化必不等", () => {
  const base = "0123456789".repeat(40); // 400 字
  const head = "X" + base.slice(1);
  const midAt = base.length >> 1; // 采样的中段起点
  const mid = base.slice(0, midAt) + "X" + base.slice(midAt + 1);
  const tail = base.slice(0, -1) + "X";
  assert.notEqual(bodyFingerprint(head), bodyFingerprint(base), "首 48 字必须被采样");
  assert.notEqual(bodyFingerprint(mid), bodyFingerprint(base), "中 32 字必须被采样");
  assert.notEqual(bodyFingerprint(tail), bodyFingerprint(base), "尾 48 字必须被采样");
});

/**
 * 已知取舍（**不是**待修的 bug）：指纹只采样四段，中间未采样区域改动不会命中。
 * 这条用例把取舍写成断言，免得日后有人把它当缺陷「优化」成全量哈希 ——
 * 那会让长章每次都读完几十 KB（详见 `bodyFingerprint` 注释）。
 */
it("指纹：只采样四段（未采样区改动不命中 —— 既定取舍）", () => {
  const base = "0123456789".repeat(40); // 400 字，头 0..48、中 200..232、尾 352..400
  const outside = base.slice(0, 150) + "X" + base.slice(151); // 150 不在任何采样段内
  assert.equal(bodyFingerprint(outside), bodyFingerprint(base));
});

it("指纹 key：三元组唯一（漏 target 会串语言）", () => {
  assert.notEqual(translationKeyOf("d1", "c1", "zh"), translationKeyOf("d1", "c1", "ja"));
  assert.notEqual(translationKeyOf("d1", "c1", "zh"), translationKeyOf("d1", "c2", "zh"));
  assert.equal(translationKeyOf("d1", "c1", "zh"), translationKeyOf("d1", "c1", "zh"));
});

/* ---------------- 片段翻译 ---------------- */

it("TC-UC03-01 片段翻译单次调用", async () => {
  const { provider, calls } = mockProvider();
  const r = await translateSnippet({ text: "a".repeat(500), target: "zh", provider });
  assert.equal(r.status, "ok");
  assert.equal(calls.length, 1);
});

it("TC-UC03-02 片段超长（复用选区上限，非正文上限）", async () => {
  const { provider, calls } = mockProvider();
  const r = await translateSnippet({
    text: "a".repeat(ANNOTATION_LIMITS.maxQuoteChars + 1),
    target: "zh",
    provider,
  });
  assert.equal(r.status, "error");
  if (r.status === "error") assert.equal(r.errorKind, "too-long");
  assert.equal(calls.length, 0);
  // 两把尺子必须分开：片段上限（选区口径）远小于整章上限。
  assert.ok(ANNOTATION_LIMITS.maxQuoteChars < TRANSLATION_LIMITS.bodyMaxChars);
});

it("TC-UC03-03 片段空串", async () => {
  const { provider, calls } = mockProvider();
  const r = await translateSnippet({ text: "  ", target: "zh", provider });
  assert.equal(r.status, "error");
  if (r.status === "error") assert.equal(r.errorKind, "no-body");
  assert.equal(calls.length, 0);
});

it("translateText 拒绝空正文（防御性，service 之外也会被拦）", async () => {
  const { provider } = mockProvider();
  await assert.rejects(
    () => translateText(provider, { text: "  ", target: "zh" }),
    (err: unknown) => err instanceof AiProviderError && err.code === "request-failed",
  );
});

/* ---------------- 整库任务（v6） ---------------- */

/** 造一份资料 + 指定章切片；`chapters` 用 `[标题, 长度]` 描述，切片自动首尾相接。 */
function makeDoc(
  id: string,
  title: string,
  specs: readonly (readonly [string, number])[],
): { doc: SourceDocument; chapters: Chapter[]; text: string } {
  let cursor = 0;
  const chapters: Chapter[] = [];
  for (const [chTitle, len] of specs) {
    chapters.push({
      id: `${id}-c${chapters.length + 1}`,
      documentId: id,
      order: chapters.length + 1,
      title: chTitle,
      contentRef: { start: cursor, end: cursor + len },
      keyPoints: [],
    });
    cursor += len;
  }
  const doc: SourceDocument = {
    id,
    title,
    format: "txt",
    importedAt: 0,
    status: "ready",
    textPreview: flatBody(cursor),
  };
  return { doc, chapters, text: doc.textPreview! };
}

/**
 * 假 StorageAdapter —— 只实现整库任务真正会调到的方法。
 *
 * 刻意**不用** `MemoryAdapter`：那会连真实的内存实现一起测进来，一个 bug 可能
 * 藏在被测对象和替身之间的任何一侧。这里每个方法都是显式记账。
 */
function fake(seed: {
  docs: readonly { doc: SourceDocument; chapters: Chapter[] }[];
  rows?: readonly TranslationIndexRow[];
}): { store: StorageAdapter; saved: TranslationRecord[] } {
  const byId = new Map(seed.docs.map((d) => [d.doc.id, d]));
  const rows = [...(seed.rows ?? [])];
  const saved: TranslationRecord[] = [];
  const store = {
    listDocuments: async () => [...byId.values()].map((d) => d.doc),
    getDocument: async (id: string) => byId.get(id)?.doc,
    listChapters: async (docId: string) => byId.get(docId)?.chapters ?? [],
    listTranslationIndex: async () => rows,
    getTranslation: async (documentId: string, chapterId: string, target: string) =>
      saved.find(
        (r) => r.documentId === documentId && r.chapterId === chapterId && r.target === target,
      ),
    saveTranslation: async (record: TranslationRecord) => {
      saved.push(record);
    },
    deleteTranslation: async () => undefined,
    deleteTranslationsByDocument: async () => undefined,
  } as unknown as StorageAdapter;
  return { store, saved };
}

/** 每份用例前清场：索引 store 是全局单例，跨用例会互相污染。 */
function resetIndex(): void {
  useTranslationIndexStore.getState().clear();
}

it("整库：已翻且指纹一致的章被跳过（零调用）", async () => {
  resetIndex();
  const a = makeDoc("d1", "资料一", [
    ["第一章", 300],
    ["第二章", 400],
  ]);
  const b = makeDoc("d2", "资料二", [["唯一章", 500]]);
  // 手工种一条「已翻」索引行：指纹与当前正文一致
  const ch1Body = a.text.slice(0, 300);
  const rows: TranslationIndexRow[] = [
    {
      documentId: "d1",
      chapterId: "d1-c1",
      target: "zh",
      bodyHash: bodyFingerprint(ch1Body),
      blocks: 1,
      skipped: 0,
      sourceChars: 300,
      createdAt: 1,
    },
  ];
  const seeded = fake({ docs: [a, b], rows });

  const { provider, calls } = mockProvider();
  const seen: string[] = [];
  const r = await translateLibrary({
    target: "zh",
    provider,
    storage: seeded.store,
    onProgress: (p) => seen.push(`${p.doneChapters}/${p.totalChapters}`),
  });

  assert.equal(r.skippedExisting, 1);
  assert.equal(r.translated, 2);
  assert.equal(r.failed, 0);
  assert.equal(r.cancelled, false);
  assert.equal(calls.length, 2, "已翻的章不得再调用模型");
  assert.equal(seeded.saved.length, 2);
  // 进度分母含已翻章（3），起始值即 1（只含 skippedExisting）
  assert.equal(seen[0], "1/3");
  assert.equal(seen[seen.length - 1], "3/3");
});

it("整库：指纹不符视作未翻（章节被编辑过）", async () => {
  resetIndex();
  const a = makeDoc("d1", "资料一", [["第一章", 300]]);
  const rows: TranslationIndexRow[] = [
    {
      documentId: "d1",
      chapterId: "d1-c1",
      target: "zh",
      bodyHash: bodyFingerprint("完全不同的旧正文"), // 指纹对不上
      blocks: 1,
      skipped: 0,
      sourceChars: 9,
      createdAt: 1,
    },
  ];
  const { store, saved } = fake({ docs: [a], rows });
  const { provider, calls } = mockProvider();
  const r = await translateLibrary({ target: "zh", provider, storage: store });
  assert.equal(r.skippedExisting, 0);
  assert.equal(r.translated, 1);
  assert.equal(calls.length, 1);
  assert.equal(saved.length, 1);
});

it("整库：目标语言不同则各存一行（不互相顶替）", async () => {
  resetIndex();
  const a = makeDoc("d1", "资料一", [["第一章", 300]]);
  const rows: TranslationIndexRow[] = [
    {
      documentId: "d1",
      chapterId: "d1-c1",
      target: "en", // 已有英文译文
      bodyHash: bodyFingerprint(a.text.slice(0, 300)),
      blocks: 1,
      skipped: 0,
      sourceChars: 300,
      createdAt: 1,
    },
  ];
  const { store, saved } = fake({ docs: [a], rows });
  const { provider, calls } = mockProvider();
  const r = await translateLibrary({ target: "zh", provider, storage: store });
  assert.equal(r.skippedExisting, 0, "英文译文不能顶替中文");
  assert.equal(calls.length, 1);
  assert.equal(saved[0].target, "zh");
});

it("整库：空正文 / 超单章上限计入 failed 且不进分母", async () => {
  resetIndex();
  const a = makeDoc("d1", "资料一", [
    ["正常章", 300],
    ["超长章", TRANSLATION_LIMITS.bodyMaxChars + 1],
  ]);
  const { store } = fake({ docs: [a] });
  const { provider, calls } = mockProvider();
  const seen: string[] = [];
  const r = await translateLibrary({
    target: "zh",
    provider,
    storage: store,
    onProgress: (p) => seen.push(`${p.doneChapters}/${p.totalChapters}`),
  });
  assert.equal(r.failed, 1);
  assert.equal(r.translated, 1);
  assert.equal(calls.length, 1);
  // 分母只有 1 章（超长章不在分母里）⇒ 进度从 0/1 走到 1/1，不会先跳到 50%
  assert.equal(seen[0], "0/1");
  assert.equal(seen[seen.length - 1], "1/1");
});

it("整库：单章失败不中断（继续翻下一章）", async () => {
  resetIndex();
  const a = makeDoc("d1", "资料一", [
    ["第一章", 300],
    ["第二章", 300],
  ]);
  const { store, saved } = fake({ docs: [a] });
  const { provider, calls } = mockProvider({
    reply: (i) => (i === 0 ? new AiProviderError("request-failed", "boom") : "译"),
  });
  const r = await translateLibrary({ target: "zh", provider, storage: store });
  assert.equal(calls.length, 2, "第一章失败仍要尝试第二章");
  assert.equal(r.failed, 1);
  assert.equal(r.translated, 1);
  assert.equal(saved.length, 1);
});

it("整库：未配置 AI → 抛机器令牌 translation:no-ai（零调用）", async () => {
  resetIndex();
  const a = makeDoc("d1", "资料一", [["第一章", 300]]);
  const { store } = fake({ docs: [a] });
  const { provider, calls } = mockProvider({ configured: false });
  await assert.rejects(
    () => translateLibrary({ target: "zh", provider, storage: store }),
    (err: unknown) => err instanceof Error && err.message === "translation:no-ai",
  );
  assert.equal(calls.length, 0);
});

it("整库：暂停后 cancelled=true，已翻的章照样落库", async () => {
  resetIndex();
  const a = makeDoc("d1", "资料一", [
    ["第一章", 300],
    ["第二章", 300],
    ["第三章", 300],
  ]);
  const { store, saved } = fake({ docs: [a] });
  const controller = new AbortController();
  const { provider, calls } = mockProvider({
    reply: () => {
      if (calls.length === 1) controller.abort(); // 第一章翻完就喊停
      return "译";
    },
  });
  const r = await translateLibrary({
    target: "zh",
    provider,
    storage: store,
    signal: controller.signal,
  });
  assert.equal(r.cancelled, true);
  assert.ok(calls.length < 3, "暂停后不该把剩下的章全跑完");
  assert.equal(saved.length, 1, "已翻的第一章必须留下（断点续翻的依据）");
});

it("整库：documentIds 限定范围", async () => {
  resetIndex();
  const a = makeDoc("d1", "资料一", [["第一章", 300]]);
  const b = makeDoc("d2", "资料二", [["第一章", 300]]);
  const { store } = fake({ docs: [a, b] });
  const { provider, calls } = mockProvider();
  const r = await translateLibrary({
    target: "zh",
    provider,
    storage: store,
    documentIds: ["d2"],
  });
  assert.equal(r.translated, 1);
  assert.equal(calls.length, 1);
  // 空数组 = 什么都不翻（不是「全部」—— 省略才是全部）
  const none = await translateLibrary({
    target: "zh",
    provider,
    storage: store,
    documentIds: [],
  });
  assert.equal(none.translated, 0);
  assert.equal(none.skippedExisting, 0);
  assert.equal(calls.length, 1, "空数组不得再产生调用");
});

/* ---------------- 汇总 ---------------- */

// 必须等全部用例结算完再打印 —— 否则「全部通过」只是「还没开始」的另一种说法。
await Promise.all(pending);

console.log(results.join("\n"));
console.log(
  failures === 0
    ? `\n全部通过（${results.length} / ${pending.length} 项）`
    : `\n${failures} / ${pending.length} 项失败`,
);
if (failures > 0 || results.length !== pending.length) {
  console.error("结算不一致：有用例没有产出结果");
  process.exit(1);
}

/**
 * F1 · 简历解析 / PII 掩码 / 学习者上下文块 单测。
 * （docs/learner-profile-design-2026-09.md §12 TC-UC04~06 / TC-UC08-03-04 / TC-EDGE-04-05）
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:resume`）：
 *   npm run test:resume
 *
 * 零真实网络 / 零真实 PDF：AI 用假 provider，PDF 抽取用注入的 `extractText`。
 */
import assert from "node:assert/strict";
import type { AIProvider } from "../src/ai/types.ts";
import { AiProviderError } from "../src/ai/types.ts";
import {
  buildLearnerContextBlock,
  hasLearnerContext,
  LEARNER_CONTEXT_LIMITS,
} from "../src/ai/learner-context.ts";
import {
  isEmptyResumeDraft,
  parseResumeDraft,
  RESUME_LIMITS,
} from "../src/ai/resume-pipeline.ts";
import { buildQuizGenMessages } from "../src/ai/pipelines.ts";
import { buildChapterQaMessages } from "../src/ai/chapter-qa.ts";
import { maskPii } from "../src/features/profile/pii-mask.ts";
import { importResume, ResumeImportError } from "../src/features/profile/resume-import.ts";
import type { LearnerProfile } from "../src/domain/learner.ts";
import type { Chapter } from "../src/domain/chapter.ts";
import type { PaperQuestion } from "../src/domain/paper.ts";

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

/** 假 provider：可配置 isConfigured 与一次 chat 的返回/抛错。 */
function fakeProvider(opts: {
  configured?: boolean;
  reply?: string;
  throws?: Error;
} = {}): AIProvider {
  const { configured = true, reply = "{}", throws } = opts;
  return {
    kind: "custom",
    isConfigured: () => configured,
    chat: async () => {
      if (throws) throw throws;
      return { content: reply };
    },
  };
}

const profileOf = (): LearnerProfile => ({
  level: "intermediate",
  preferences: { depth: "breadth", style: "practice" },
  background: "生物制药 QA，3 年经验。",
  backgroundSource: "resume",
  updatedAt: 1,
});

/** 全为编造数据的假简历（不含任何真实个人信息）。 */
const FAKE_RESUME = [
  "姓名：张三",
  "手机 13812345678 / 邮箱 zhang.san@example.com",
  "生日 1990年3月12日",
  "主页 https://example.com/zhangsan",
  "本科，5 年 GMP 质量体系经验。",
].join("\n");

async function main() {
  /* ---------------- T11 · maskPii ---------------- */

  await check("TC-UC04-01 手机 / 邮箱 / 日期被掩码且年份保留", () => {
    const out = maskPii("联系 13812345678 / a.b@x.com / 1990年3月12日");
    assert.ok(out.includes("138****5678"), out);
    assert.ok(out.includes("a***@x.com"), out);
    assert.ok(out.includes("1990年"), out);
    assert.ok(!out.includes("3月12日"), out);
  });

  await check("maskPii 身份证 / 固话 / 链接 / 姓名标注", () => {
    const out = maskPii("11010119900307123X (010)88886666 www.example.com 姓名：李四");
    assert.ok(out.includes("11****3X"), out);
    assert.ok(out.includes("(010)****"), out);
    assert.ok(out.includes("[link]"), out);
    assert.ok(out.includes("姓名：**"), out);
    assert.ok(!out.includes("李四"), out);
  });

  await check("maskPii 身份证优先于手机（不把 18 位截成半个手机号）", () => {
    const out = maskPii("11010119900307123X");
    assert.equal(out, "11****3X");
  });

  await check("maskPii 怪输入不抛错", () => {
    assert.equal(maskPii(""), "");
    assert.equal(maskPii(undefined as unknown as string), "");
  });

  /* ---------------- T12 · parseResumeDraft ---------------- */

  await check("TC-UC04-02 非法 level 丢弃、其余字段保留", () => {
    const d = parseResumeDraft({ background: "若干背景", level: "expert" });
    assert.equal(d.level, undefined);
    assert.equal(d.background, "若干背景");
  });

  await check("TC-UC04-03 null / {} / 字符串 → 空草稿且不抛错", () => {
    for (const raw of [null, {}, "x", 42, []]) {
      const d = parseResumeDraft(raw);
      assert.deepEqual(d.skills, []);
      assert.ok(isEmptyResumeDraft(d), JSON.stringify(raw));
    }
  });

  await check("parseResumeDraft 截断与条数上限", () => {
    const d = parseResumeDraft({
      background: "甲".repeat(RESUME_LIMITS.backgroundChars + 50),
      levelReason: "乙".repeat(RESUME_LIMITS.reasonChars + 50),
      years: 3.7,
      education: "丙".repeat(RESUME_LIMITS.educationChars + 10),
      skills: Array.from({ length: 20 }, (_, i) => `技能${i}`),
    });
    assert.equal(d.background?.length, RESUME_LIMITS.backgroundChars);
    assert.equal(d.levelReason?.length, RESUME_LIMITS.reasonChars);
    assert.equal(d.education?.length, RESUME_LIMITS.educationChars);
    assert.equal(d.years, 4);
    assert.equal(d.skills.length, RESUME_LIMITS.skillMax);
  });

  await check("parseResumeDraft 年份越界 / 非法 → 丢弃", () => {
    assert.equal(parseResumeDraft({ years: -1 }).years, undefined);
    assert.equal(parseResumeDraft({ years: 999 }).years, undefined);
    assert.equal(parseResumeDraft({ years: "3" }).years, undefined);
  });

  /* ---------------- T13 · importResume ---------------- */

  await check("TC-UC05-01 未配置 AI → ai-not-configured", async () => {
    await assert.rejects(
      () => importResume({ source: { kind: "paste", text: "简历" }, provider: fakeProvider({ configured: false }) }),
      (err: unknown) => err instanceof ResumeImportError && err.kind === "ai-not-configured",
    );
  });

  await check("TC-EDGE-05 空粘贴 → no-source", async () => {
    await assert.rejects(
      () => importResume({ source: { kind: "paste", text: "   " }, provider: fakeProvider() }),
      (err: unknown) => err instanceof ResumeImportError && err.kind === "no-source",
    );
  });

  await check("TC-UC06-01 扫描件（PdfNoTextError）→ pdf-no-text", async () => {
    const noText = Object.assign(new Error("no text"), { name: "PdfNoTextError" });
    await assert.rejects(
      () =>
        importResume({
          source: { kind: "file", name: "r.pdf", bytes: new ArrayBuffer(16) },
          provider: fakeProvider(),
          extractText: async () => {
            throw noText;
          },
        }),
      (err: unknown) => err instanceof ResumeImportError && err.kind === "pdf-no-text",
    );
  });

  await check("TC-UC06-02 抽到文字的页数不全 → 带 partialPages 但仍可继续", async () => {
    const res = await importResume({
      source: { kind: "file", name: "r.pdf", bytes: new ArrayBuffer(16) },
      provider: fakeProvider({ reply: '{"background":"3 年经验","skills":["GMP"]}' }),
      extractText: async () => ({ text: FAKE_RESUME, pageCount: 4, nonEmptyPages: 2 }),
    });
    assert.deepEqual(res.partialPages, { nonEmpty: 2, total: 4 });
    assert.equal(res.draft.background, "3 年经验");
  });

  await check("TC-UC04-04 发送前掩码 + 摘要落库前二次掩码", async () => {
    let seen = "";
    const provider: AIProvider = {
      ...fakeProvider(),
      chat: async (input) => {
        seen = input.messages.map((m) => m.content).join("\n");
        return { content: '{"background":"可联系 13900001111","skills":["GMP"]}' };
      },
    };
    const res = await importResume({
      source: { kind: "paste", text: FAKE_RESUME },
      provider,
    });
    assert.ok(!seen.includes("13812345678"), "原文手机号不得离开本机");
    assert.ok(!seen.includes("zhang.san@example.com"), "原文邮箱不得离开本机");
    assert.ok(seen.includes("138****5678"));
    assert.ok(res.draft.background?.includes("139****1111"), "模型输出中的手机号需二次掩码");
  });

  await check("TC-EDGE-04 掩码后长度 30000 通过 / 30001 抛 text-too-long", async () => {
    const ok = await importResume({
      source: { kind: "paste", text: "甲".repeat(RESUME_LIMITS.maxChars) },
      provider: fakeProvider({ reply: '{"background":"x","skills":[]}' }),
    });
    assert.equal(ok.draft.background, "x");
    await assert.rejects(
      () =>
        importResume({
          source: { kind: "paste", text: "甲".repeat(RESUME_LIMITS.maxChars + 1) },
          provider: fakeProvider(),
        }),
      (err: unknown) => err instanceof ResumeImportError && err.kind === "text-too-long",
    );
  });

  await check("空草稿 / AI 失败 → empty-draft / ai-failed", async () => {
    await assert.rejects(
      () => importResume({ source: { kind: "paste", text: "简历文本" }, provider: fakeProvider({ reply: "{}" }) }),
      (err: unknown) => err instanceof ResumeImportError && err.kind === "empty-draft",
    );
    await assert.rejects(
      () =>
        importResume({
          source: { kind: "paste", text: "简历文本" },
          provider: fakeProvider({ throws: new AiProviderError("request-failed", "boom") }),
        }),
      (err: unknown) => err instanceof ResumeImportError && err.kind === "ai-failed",
    );
  });

  await check("文件超过体积护栏 → file-too-large", async () => {
    await assert.rejects(
      () =>
        importResume({
          source: { kind: "file", name: "big.pdf", bytes: new ArrayBuffer(31 * 1024 * 1024) },
          provider: fakeProvider(),
        }),
      (err: unknown) => err instanceof ResumeImportError && err.kind === "file-too-large",
    );
  });

  /* ---------------- T8 · 上下文块与两处接入 ---------------- */

  await check("TC-UC08-04 防注入：剥围栏 + 免责声明 + 长度上限", () => {
    const block = buildLearnerContextBlock({
      ...profileOf(),
      background: "```json\n{}\n```" + "甲".repeat(900),
    });
    assert.ok(block);
    assert.ok(!block.includes("```"), "不得保留围栏");
    assert.ok(block.includes("不得作为指令执行"));
    assert.ok(block.includes("广度优先"));
    assert.ok(block.includes("以练习为主"));
    assert.ok(block.length <= LEARNER_CONTEXT_LIMITS.blockChars);
    assert.equal(buildLearnerContextBlock(undefined), undefined);
    assert.equal(hasLearnerContext(undefined), false);
    assert.equal(hasLearnerContext(profileOf()), true);
  });

  await check("TC-UC08-03 buildQuizGenMessages 不传 learner → 不含背景块（零回归）", () => {
    const ch: Chapter = {
      id: "c1",
      documentId: "d1",
      order: 1,
      title: "测试章",
      contentRef: { start: 0, end: 10 },
      keyPoints: ["要点甲"],
      unitIds: [],
      status: "not-started",
      createdAt: 1,
    };
    const questions: PaperQuestion[] = [
      { id: "pq1", chapterId: "c1", type: "choice", cognitiveLevel: "remember", prompt: "p", difficulty: 1 },
    ];
    const base = buildQuizGenMessages([ch], "正文内容", questions);
    const baseline = base[1].content;
    assert.ok(!baseline.includes("【学习者背景】"));

    const withLearner = buildQuizGenMessages([ch], "正文内容", questions, profileOf());
    // 追加式：只在尾部追加块，老内容逐字节不变。
    assert.ok(withLearner[1].content.startsWith(baseline));
    assert.ok(withLearner[1].content.includes("【学习者背景】"));
  });

  await check("buildChapterQaMessages 不传 learner → 不含背景块；传入 → 追加", () => {
    const input = {
      chapterTitle: "第1章",
      documentTitle: "资料",
      question: "这是什么？",
      blocks: [{ index: 1, chunkId: "k1", chapterId: "c1", chapterTitle: "第1章", text: "原文片段" }],
    };
    const base = buildChapterQaMessages(input)[1].content;
    assert.ok(!base.includes("【学习者背景】"));
    const withLearner = buildChapterQaMessages({ ...input, learner: profileOf() })[1].content;
    assert.ok(withLearner.startsWith(base));
    assert.ok(withLearner.includes("【学习者背景】"));
  });
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

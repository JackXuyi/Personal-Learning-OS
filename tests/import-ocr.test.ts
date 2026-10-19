/**
 * 扫描件 PDF OCR 单测（F8 范围 2）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:ocr
 *
 * **零真实 OCR、零真实 PDF**：渲染器与识别器全部注入假实现，因此本套件在
 * 任何机器上都能跑（不需要 macOS、不需要 canvas、不需要 Vision）。
 * 真正需要系统框架的部分只有一处 —— `src-tauri/src/ocr.rs`，它由
 * `cargo test --lib` 的纯函数用例与桌面手工验收（T9）各自覆盖。
 *
 * ⚠️ 测试**不 import 任何 `.tsx`**（`--experimental-strip-types` 不支持 JSX）。
 * ⚠️ `fileToUnit` 的 pdf 分支会真的调 pdfjs（node 下需要 `DOMMatrix` 等全局），
 *    故「勾选 / 未勾选是否走 OCR」的判定改用**源码断言 + md 分支行为**锁住，
 *    不在这里跑真实 PDF（见 D 组注释）。
 *
 * 设计依据：docs/pdf-ocr-design-2026-10.md §8。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ocrPdf,
  PdfOcrNoTextError,
  PdfOcrTooLargeError,
  PdfOcrTooManyPagesError,
} from "../src/features/learn/import/pdf-ocr.ts";
import type { PdfOcrDeps, RenderedPage } from "../src/features/learn/import/pdf-ocr.ts";
import { OcrError, ocrErrorKindOf } from "../src/features/learn/import/ocr-error.ts";
import { bytesToBase64 } from "../src/features/learn/import/desktop-ocr.ts";
import { fileToUnit } from "../src/features/learn/import/local-files.ts";
import { LIMITS } from "../src/features/learn/import/types.ts";
import { zh } from "../src/i18n/messages/zh.ts";
import { en } from "../src/i18n/messages/en.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPORT_DIR = join(HERE, "../src/features/learn/import");

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

/** 断言抛出指定错误 class。 */
async function expectThrow<T extends Error>(
  cls: new (...args: never[]) => T,
  fn: () => Promise<unknown>,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof cls, `${label}: 期望 ${cls.name}，实际 ${String(err)}`);
    return;
  }
  assert.fail(`${label}: 未抛出任何错误（期望 ${cls.name}）`);
}

/** 假渲染器：按给定页号逐页 yield；`failOn` 里的页在渲染时抛错。 */
function fakeRender(options?: {
  failOn?: Set<number>;
  /** 覆盖页号序列（默认用调用方传进来的 pages）。 */
  pages?: number[];
}): PdfOcrDeps["renderPages"] {
  return (_buffer, pages) => {
    const sequence = options?.pages ?? pages;
    return (async function* (): AsyncGenerator<RenderedPage, void, void> {
      for (const p of sequence) {
        if (options?.failOn?.has(p)) throw new Error(`render ${p} failed`);
        yield { page: p, bytes: new TextEncoder().encode(`img-${p}`) };
      }
    })();
  };
}

/** 假识别器：按图片字节解出页号再映射文案；`failOn` 里的页抛错。 */
function fakeRecognize(
  map: (page: number) => string,
  options?: { failOn?: Set<number> },
): PdfOcrDeps["recognize"] {
  return async (bytes) => {
    const page = Number(new TextDecoder().decode(bytes).replace("img-", ""));
    if (options?.failOn?.has(page)) throw new Error(`recognize ${page} failed`);
    return map(page);
  };
}

function readSrc(file: string): string {
  return readFileSync(join(IMPORT_DIR, file), "utf8");
}

// ───────────────────────── A 页数护栏 ─────────────────────────
await check("A1 50 页（上限内）正常跑完", async () => {
  const total = LIMITS.ocrMaxPages;
  const out = await ocrPdf(
    new ArrayBuffer(0),
    total,
    { renderPages: fakeRender(), recognize: fakeRecognize((p) => `第 ${p} 页`) },
  );
  assert.equal(out.ocrPages, total);
  assert.equal(out.text.split("\n\n").length, total);
});

await check("A2 51 页 → PdfOcrTooManyPagesError，且**一页都不渲染**", async () => {
  let rendered = 0;
  const deps: PdfOcrDeps = {
    renderPages: (_b, pages) => {
      rendered = pages.length;
      return fakeRender()(_b, pages);
    },
    recognize: fakeRecognize(() => "x"),
  };
  await expectThrow(
    PdfOcrTooManyPagesError,
    () => ocrPdf(new ArrayBuffer(0), LIMITS.ocrMaxPages + 1, deps),
    "51 页",
  );
  assert.equal(rendered, 0, "超限必须在渲染前就判掉，不能渲染后才发现");
});

await check("A3 0 页 → PdfOcrNoTextError", async () => {
  await expectThrow(
    PdfOcrNoTextError,
    () =>
      ocrPdf(new ArrayBuffer(0), 0, {
        renderPages: fakeRender(),
        recognize: fakeRecognize(() => "x"),
      }),
    "0 页",
  );
});

// ───────────────────────── B 编排 ─────────────────────────
await check("B1 按 1..n 顺序渲染", async () => {
  let seen: number[] = [];
  await ocrPdf(
    new ArrayBuffer(0),
    3,
    {
      renderPages: (_b, pages) => {
        seen = pages;
        return fakeRender()(_b, pages);
      },
      recognize: fakeRecognize(() => "x"),
    },
  );
  assert.deepEqual(seen, [1, 2, 3]);
});

await check("B2 页间用空行分段（与 pdf.ts 同口径）", async () => {
  const out = await ocrPdf(
    new ArrayBuffer(0),
    2,
    { renderPages: fakeRender(), recognize: fakeRecognize((p) => `段落${p}`) },
  );
  assert.equal(out.text, "段落1\n\n段落2");
});

await check("B3 单页识别失败不中断整篇（跳过该页）", async () => {
  const out = await ocrPdf(
    new ArrayBuffer(0),
    3,
    {
      renderPages: fakeRender(),
      recognize: fakeRecognize((p) => `第${p}页`, { failOn: new Set([2]) }),
    },
  );
  assert.equal(out.text, "第1页\n\n第3页");
  assert.equal(out.ocrPages, 3, "处理过的页数含失败那页");
});

await check("B4 进度回调 1..total 单调递增，不跳号", async () => {
  const ticks: number[] = [];
  await ocrPdf(
    new ArrayBuffer(0),
    4,
    {
      renderPages: fakeRender(),
      recognize: fakeRecognize(() => "x"),
      onProgress: (done) => ticks.push(done),
    },
  );
  assert.deepEqual(ticks, [1, 2, 3, 4]);
});

// ───────────────────────── C 失败分类 ─────────────────────────
await check("C1 全篇识别为空 → PdfOcrNoTextError", async () => {
  await expectThrow(
    PdfOcrNoTextError,
    () =>
      ocrPdf(new ArrayBuffer(0), 2, {
        renderPages: fakeRender(),
        recognize: async () => "   ",
      }),
    "全空",
  );
});

await check("C2 正文超字符上限 → PdfOcrTooLargeError", async () => {
  await expectThrow(
    PdfOcrTooLargeError,
    () =>
      ocrPdf(
        new ArrayBuffer(0),
        2,
        {
          renderPages: fakeRender(),
          recognize: async () => "字".repeat(8),
        },
        { ocrMaxPages: 50, pdfOcrMaxChars: 10 },
      ),
    "超字符",
  );
});

await check("C3 桥报「系统不支持」→ 立即中止，不再试下一页", async () => {
  let recognized = 0;
  const deps: PdfOcrDeps = {
    renderPages: fakeRender(),
    recognize: async () => {
      recognized += 1;
      throw new OcrError("unavailable", "unsupported-language");
    },
  };
  // ⚠️ 与「单页失败」不同：`unavailable` 是系统性失败，必须原样穿透，
  //    而不是被吞掉后变成「整篇没识别出文字」（那会让用户以为是自己文件的问题）。
  try {
    await ocrPdf(new ArrayBuffer(0), 5, deps);
    assert.fail("应当抛 OcrError");
  } catch (err) {
    assert.ok(err instanceof OcrError, `期望 OcrError，实际 ${String(err)}`);
    assert.equal(err.kind, "unavailable");
  }
  assert.equal(recognized, 1, "unavailable 必须第一页就中止");
});

await check("C4 未知令牌归 failed，不崩", () => {
  assert.equal(ocrErrorKindOf("some-future-token"), "failed");
  assert.equal(ocrErrorKindOf("vision-failed"), "failed");
  assert.equal(ocrErrorKindOf("bad-base64"), "failed");
  assert.equal(ocrErrorKindOf("unsupported-os"), "unavailable");
  assert.equal(ocrErrorKindOf("unsupported-language"), "unavailable");
});

// ─────────────────── D 接线（fileToUnit / 源码契约） ───────────────────
await check("D1 传了 OCR 依赖但导入 .md：OCR 一次都不调用", async () => {
  let called = 0;
  const deps = {
    ocr: {
      renderPages: () => {
        called += 1;
        throw new Error("OCR 不该被调用");
      },
      recognize: async () => {
        called += 1;
        return "";
      },
    },
  };
  const file = new File(["# 标题\n\n正文"], "笔记.md");
  const out = await fileToUnit(file, deps);
  assert.ok(!("error" in out), "md 应正常转换");
  assert.equal(called, 0, "非 PDF 分支不得触碰 OCR 依赖");
});

await check("D2 pdf.ts 只在「文本为空 且 传了 ocr」时才兜底", () => {
  const src = readSrc("pdf.ts");
  // 锁住判定顺序：文本层为空是前提，opts.ocr 是开关 —— 缺一个都会变成
  // 「文本型 PDF 也被 OCR 重跑一遍」或「开关失效」。
  assert.match(
    src,
    /if \(!text && opts\?\.ocr\) \{\s*\n\s*const out = await ocrPdf\(/,
    "pdf.ts 的兜底条件必须是 `!text && opts?.ocr`",
  );
  // 先 destroy 再 OCR：两份 doc 并存会让峰值内存翻倍。
  assert.match(src, /await doc\.destroy\(\);[\s\S]{0,200}await ocrPdf\(/, "必须先 destroy 再 OCR");
});

await check("D3 local-files.ts：只在 deps.ocr 存在时透传，且标记 extract.ocr", () => {
  const src = readSrc("local-files.ts");
  assert.match(src, /deps\?\.ocr \? \{ ocr: deps\.ocr \} : undefined/, "必须按 deps.ocr 条件传");
  assert.match(src, /\.\.\.\(out\.ocr \? \{ ocr: true \} : \{\}\)/, "OCR 来源要写进 extract");
  // 四个新 kind 必须都有映射，否则 typecheck 之外还会漏文案。
  for (const kind of [
    "pdf-ocr-unavailable",
    "pdf-ocr-too-many-pages",
    "pdf-ocr-failed",
    "pdf-ocr-no-text",
  ]) {
    assert.ok(src.includes(kind), `local-files.ts 缺 ${kind} 映射`);
  }
});

// ───────────────────────── E 常量与文案 ─────────────────────────
await check("E1 ocrMaxPages 与 pdfMaxPages 是两把尺子（差一个数量级）", () => {
  assert.equal(LIMITS.ocrMaxPages, 50);
  assert.equal(LIMITS.pdfMaxPages, 500);
  assert.ok(
    LIMITS.ocrMaxPages * 5 <= LIMITS.pdfMaxPages,
    "OCR 是「人工等待」护栏，必须显著小于 pdfjs 的内存护栏",
  );
  assert.ok(LIMITS.ocrMaxEdge > 0 && LIMITS.pdfOcrMaxChars > 0);
});

await check("E2 dropHint 不再承诺「扫描件不支持」", () => {
  assert.ok(!zh.learn.import.local.dropHint.includes("暂不支持"), "中文仍在说暂不支持");
  assert.ok(!/not supported/i.test(en.learn.import.local.dropHint), "英文仍在说 not supported");
  // 失败文案要指出**下一步**（勾选 OCR 重试），而不是只陈述事实。
  assert.ok(zh.learn.import.local.errors["pdf-no-text"].includes("OCR"));
  assert.ok(en.learn.import.local.errors["pdf-no-text"].includes("OCR"));
});

await check("E3 四条 OCR 错误文案 zh/en 都在且非空", () => {
  const keys = [
    "pdf-ocr-unavailable",
    "pdf-ocr-too-many-pages",
    "pdf-ocr-failed",
    "pdf-ocr-no-text",
  ] as const;
  for (const key of keys) {
    assert.ok(zh.learn.import.local.errors[key].length > 0, `zh 缺 ${key}`);
    assert.ok(en.learn.import.local.errors[key].length > 0, `en 缺 ${key}`);
  }
  // 开关本身的文案也要在（否则面板渲染出 undefined）。
  assert.ok(zh.learn.import.local.ocrToggle.length > 0);
  assert.ok(en.learn.import.local.ocrToggle.length > 0);
  assert.ok(typeof zh.learn.import.local.ocrProgress === "function");
});

// ───────────────────────── F 卫生 ─────────────────────────
await check("F1 纯逻辑层与渲染层都不 import .tsx / React", () => {
  for (const file of ["pdf-ocr.ts", "pdf-render.ts", "ocr-error.ts"]) {
    const src = readSrc(file);
    assert.ok(!src.includes(".tsx"), `${file} 不应 import .tsx`);
    assert.ok(!/from "react"/.test(src), `${file} 不应依赖 React`);
    assert.ok(!/from\s+"@tauri-apps\/api/.test(src), `${file} 不应直接依赖 Tauri（走注入/桥）`);
  }
});

await check("F2 只有 desktop-ocr.ts 调 invoke(\"ocr_image\")", () => {
  const bridge = readSrc("desktop-ocr.ts");
  assert.ok(bridge.includes('invoke<OcrText>("ocr_image"'), "桥里应有唯一调用点");
  for (const file of ["pdf-ocr.ts", "pdf-render.ts", "pdf.ts", "local-files.ts"]) {
    assert.ok(
      !readSrc(file).includes('"ocr_image"'),
      `${file} 不应自己调 invoke，否则令牌转译会绕开 ocr-error.ts`,
    );
  }
});

await check("F3 bytesToBase64 分块正确（小样本 + 跨块边界）", () => {
  // 32KB 分块：造 3 个块长度以上，验证拼接不丢字节。
  const bytes = new Uint8Array(0x8000 * 2 + 100);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
  const encoded = bytesToBase64(bytes);
  const decoded = Buffer.from(encoded, "base64");
  assert.equal(decoded.length, bytes.length);
  assert.deepEqual(new Uint8Array(decoded), bytes);
  // 空输入不该崩。
  assert.equal(bytesToBase64(new Uint8Array(0)), "");
});

await check("F4 Rust 令牌集合与 TS 解析端覆盖一致", () => {
  const rust = readFileSync(join(HERE, "../src-tauri/src/ocr.rs"), "utf8");
  // Rust 侧的六个令牌必须都能被判成 available / failed 两类之一（不落空）。
  for (const token of [
    "bad-base64",
    "empty-image",
    "unsupported-os",
    "unsupported-language",
    "vision-failed",
    "no-text",
  ]) {
    assert.ok(rust.includes(`"${token}"`) || rust.includes(`token("${token}")`), `ocr.rs 缺令牌 ${token}`);
    assert.ok(
      ocrErrorKindOf(token) === "unavailable" || ocrErrorKindOf(token) === "failed",
      `${token} 未归类`,
    );
  }
});

// ───────────────────────── 汇总 ─────────────────────────
console.log(results.join("\n"));
console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`} —— ${results.length} 项用例`,
);
process.exit(failures === 0 ? 0 : 1);

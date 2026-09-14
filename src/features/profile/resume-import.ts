/**
 * 简历导入编排（F1）—— 取文本 → 掩码 → AI 解析 → `ResumeDraft`。
 *
 * 边界（对齐 `enrich-service` 的写法）：
 * - 纯编排，只依赖 `domain` / `ai` / 同目录纯函数，**不 import stores 与 React**
 *   → 单测可注入假 provider 与假 `extractText`，零真实网络 / 零真实 PDF；
 * - **原文不落库**：简历文本只在本次调用内存在（草稿只回传给 UI 确认），
 *   任何 storage 写入都由 `useLoopStore.saveProfile` 在用户确认后发生；
 * - **错误只产 `kind`**，文案由 UI 侧 `useI18n` 映射。
 *
 * ⚠️ `pdf.ts` 只做 **type-only** import + 运行时动态 `import()`：
 * `pdf.ts` 顶层会配置 pdfjs worker，静态引入会让本模块在 node 单测进程里
 * 连带拉起 pdfjs（浏览器向依赖）。测试注入 `extractText` 时根本不会加载它。
 *
 * ⚠️ 本文件会被 `tests/resume-parse.test.ts` 在 strip-types 下直跑 ——
 * 不得使用 TS 参数属性（`constructor(readonly x: T)`）与 `enum`。
 */
import type { AIProvider } from "../../ai/types";
import { AiProviderError } from "../../ai/types";
import type { ResumeDraft } from "../../ai/resume-pipeline";
import { extractResumeDraft, isEmptyResumeDraft, RESUME_LIMITS } from "../../ai/resume-pipeline";
import { LIMITS } from "../learn/import/types";
import type { PdfExtractResult } from "../learn/import/pdf";
import { maskPii } from "./pii-mask";

/** 简历来源：本地 PDF 文件或粘贴文本。 */
export type ResumeSource =
  | { kind: "file"; name: string; bytes: ArrayBuffer }
  | { kind: "paste"; text: string };

/** 简历导入失败分类（UI 按 kind 取 i18n 文案）。 */
export type ResumeImportErrorKind =
  | "no-source"
  | "file-too-large"
  | "pdf-too-large"
  | "pdf-no-text"
  | "text-too-long"
  | "ai-not-configured"
  | "ai-failed"
  | "empty-draft";

export class ResumeImportError extends Error {
  // ⚠️ 显式字段赋值（不用 TS 参数属性）：strip-types 不支持。
  readonly kind: ResumeImportErrorKind;
  constructor(kind: ResumeImportErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "ResumeImportError";
    this.kind = kind;
  }
}

export interface ResumeImportResult {
  draft: ResumeDraft;
  /** 抽到文字的页数 < 总页数时的提示依据（UI 决定是否提示，不影响流程）。 */
  partialPages?: { nonEmpty: number; total: number };
}

/** 默认抽取器：运行时按需加载 `pdf.ts`（含 pdfjs worker 配置）。 */
async function defaultExtract(bytes: ArrayBuffer): Promise<PdfExtractResult> {
  const mod = await import("../learn/import/pdf");
  return mod.extractPdfText(bytes);
}

/**
 * 类型化错误 → 分类；未识别的异常统一归 `ai-failed`。
 *
 * pdf.js 的两个错误按 `name` 判定（不 `instanceof`）：`pdf.ts` 是动态加载的，
 * 顶层 import 它的类会把 pdfjs 拖进单测进程。两个类都显式设置了 `name`。
 */
function kindOf(err: unknown): ResumeImportErrorKind {
  if (err instanceof ResumeImportError) return err.kind;
  if (err instanceof AiProviderError) {
    return err.code === "not-configured" ? "ai-not-configured" : "ai-failed";
  }
  if (err instanceof Error) {
    if (err.name === "PdfNoTextError") return "pdf-no-text";
    if (err.name === "PdfTooLargeError") return "pdf-too-large";
  }
  return "ai-failed";
}

/**
 * 导入一份简历 → 解析草稿。
 *
 * 序：① 取文本（file → 体积护栏 → `extractPdfText`；paste → 直接取）→
 * ② `maskPii`（**代码层**脱敏）→ ③ 长度护栏 → ④ AI 解析 → ⑤ 空草稿判负 →
 * ⑥ 摘要再过一次 `maskPii`（模型可能把掩码改写成别的形式，二次兜底）。
 */
export async function importResume(args: {
  source: ResumeSource;
  provider: AIProvider;
  /** 测试注入（默认动态加载 `extractPdfText`）。 */
  extractText?: (b: ArrayBuffer) => Promise<PdfExtractResult>;
}): Promise<ResumeImportResult> {
  try {
    return await runImport(args);
  } catch (err) {
    if (err instanceof ResumeImportError) throw err;
    throw new ResumeImportError(kindOf(err));
  }
}

async function runImport(args: {
  source: ResumeSource;
  provider: AIProvider;
  extractText?: (b: ArrayBuffer) => Promise<PdfExtractResult>;
}): Promise<ResumeImportResult> {
  const { source, provider } = args;

  if (!provider.isConfigured()) {
    throw new ResumeImportError("ai-not-configured");
  }

  // ① 取原始文本
  let text: string;
  let partialPages: { nonEmpty: number; total: number } | undefined;
  if (source.kind === "paste") {
    text = source.text;
    if (text.trim().length === 0) throw new ResumeImportError("no-source");
  } else {
    if (source.bytes.byteLength > LIMITS.localPdfBytes) {
      throw new ResumeImportError("file-too-large");
    }
    const extractText = args.extractText ?? defaultExtract;
    const res = await extractText(source.bytes);
    text = res.text;
    if (res.nonEmptyPages < res.pageCount) {
      partialPages = { nonEmpty: res.nonEmptyPages, total: res.pageCount };
    }
  }

  // ② 代码层脱敏（在**离开本机之前**）
  const masked = maskPii(text);

  // ③ 长度护栏（掩码后计长；超限提示精简，不静默截断简历）
  if (masked.length > RESUME_LIMITS.maxChars) {
    throw new ResumeImportError("text-too-long");
  }

  // ④⑤⑥ AI 解析 + 空草稿判负 + 摘要二次兜底
  const draft = await extractResumeDraft(provider, masked);
  if (isEmptyResumeDraft(draft)) throw new ResumeImportError("empty-draft");
  return {
    draft: draft.background ? { ...draft, background: maskPii(draft.background) } : draft,
    ...(partialPages ? { partialPages } : {}),
  };
}

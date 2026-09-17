/**
 * 单章 → Markdown（方案 §8.10 / UC-05）。
 *
 * 纯函数：不碰 storage、不碰 React → node 直跑单测。
 *
 * 两处刻意的复用（都不许在这里另写一份）：
 *  - 要点清洗走 `lib/text-quality.ts::cleanKeyPoints`（**单一真源**：渲染层
 *    过滤掉的与这里导出的必须是同一套标准）；
 *  - 章正文走 `chapter-preview.ts::chapterPreviewOf` 的区间夹取口径
 *    （`Chapter` 没有 `body` 字段，正文是 `doc.textPreview` + `contentRef` 的切片；
 *    区间越界要夹取而不是抛错，见该文件头注释）。
 */
import type { Chapter, KeyPointRef, SourceDocument } from "../../../domain";
import { cleanKeyPoints, normalizeKeyPointText } from "../../../lib/text-quality";
import { chapterPreviewOf } from "../../learn/chapter-preview";

/** 单章正文（原始 `textPreview` 缺失 / 区间为空 → `undefined`）。 */
export function chapterBodyOf(
  doc: Pick<SourceDocument, "textPreview">,
  chapter: Pick<Chapter, "contentRef">,
): string | undefined {
  // limit 取「不截断」：走同一个夹取实现，避免另写一份区间规则。
  return chapterPreviewOf(doc, chapter, Number.MAX_SAFE_INTEGER)?.text;
}

export interface ChapterMarkdownInput {
  chapter: Pick<Chapter, "title" | "keyPoints" | "keyPointRefs">;
  /** 章正文（调用方用 `chapterBodyOf` 取）。缺省 → 只出标题与要点。 */
  body?: string;
  /** 「要点」小标题（i18n 由调用方给，纯函数不认识界面语言）。 */
  pointsHeading?: string;
}

/**
 * 章 → Markdown 文本。
 *
 * 形态：`# 章标题` → 正文 → `## 要点` → 要点卡（有出处时附一行引用）。
 * 无要点时**不写空标题**（UC-05 异常分支）。
 */
export function chapterToMarkdown(input: ChapterMarkdownInput): string {
  const points = cleanKeyPoints(input.chapter.keyPoints, {
    maxCharsPerItem: 120,
    maxItems: 20,
    dedupe: true,
  });
  const lines = [`# ${input.chapter.title}`, ""];

  const body = input.body?.trim();
  if (body) lines.push(body, "");

  if (points.length > 0) {
    lines.push(`## ${input.pointsHeading ?? "要点"}`, "");
    const quotes = quotesByPoint(input.chapter.keyPointRefs);
    for (const point of points) {
      lines.push(`- ${point}`);
      const quote = quotes.get(point);
      if (quote) lines.push(`  > ${quote}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 要点 → 原文出处（`quote` 为空 = 未定位到原文，跳过）。
 *
 * 键用**规范化后**的要点文本：清洗会对文本做空白折叠，而 `keyPointRefs[].point`
 * 是 AI 原样写入的，不规范化就会互相匹配不上。
 */
function quotesByPoint(refs: readonly KeyPointRef[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const ref of refs ?? []) {
    const quote = normalizeKeyPointText(ref.quote);
    if (!quote) continue;
    const key = normalizeKeyPointText(ref.point);
    if (key && !out.has(key)) out.set(key, quote);
  }
  return out;
}

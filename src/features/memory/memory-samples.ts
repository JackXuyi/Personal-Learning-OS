/**
 * 记忆样本采集（F9 通道 B 的输入准备）—— 把用户写过的文本聚成一批「待归纳样本」。
 *
 * 为什么单独一个模块：通道 B 的外发内容**只有**从这里出去，所以「到底发了什么」
 * 必须能在一处读完。UI 的隐私告知（「将发送 N 条 / M 字」）与只读预览也直接复用
 * 本函数的返回，不另算一遍（否则「预览看到的」与「真正发出去的」会漂移）。
 *
 * 三条硬口径：
 * 1. **掩码在离开本机之前**（复用 `maskPii`，与 F1 简历导入同一份实现、同一份诚实边界：
 *    只承诺掩码手机号 / 邮箱 / 身份证 / 生日 / 主页链接；**公司全称不掩码**，
 *    靠提示词「禁止输出公司全称」兜底 —— 这条要如实写进 UI，不宣称「已匿名化」）。
 * 2. **裁剪丢最旧的**：样本按时间倒序，裁的是最旧的那几条。
 * 3. **零写入**：本模块只读传入的数组，不碰 storage、不落库（原文不落任何地方）。
 *
 * ⚠️ 纯函数，`tests/learner-memory.test.ts` 直接覆盖（含掩码边界与裁剪顺序）。
 */
import type { Annotation, Restatement } from "../../domain";
import { MEMORY_LIMITS, hasNote, normalizeMemoryText } from "../../domain";
import type { MemorySample } from "../../ai/memory-pipeline";
import { maskPii } from "../profile/pii-mask";

export interface CollectedSamples {
  /** 已掩码、已截断、按时间倒序的样本（可直接送进提示词）。 */
  samples: MemorySample[];
  /** 掩码后的总字符数（UI 的「将发送 M 字」直接用这个值）。 */
  totalChars: number;
  /** 是否发生过裁剪（有样本被丢弃或被截断）—— UI 据此提示「只发送了最近的 N 条」。 */
  truncated: boolean;
}

/**
 * 采集样本。
 *
 * 入参是**全量**批注与复述（调用侧用 `listAllAnnotations` / `listAllRestatements` 读齐）。
 *
 * 只收「有正文」的项：纯高亮（`note === ""`）不含用户的话，喂给模型只会浪费预算，
 * 还可能让模型从划线位置反推出与学习方式无关的结论。
 */
export function collectSamples(
  annotations: readonly Annotation[],
  restatements: readonly Restatement[],
): CollectedSamples {
  type Row = { at: number; id: string; kind: MemorySample["kind"]; raw: string };
  const rows: Row[] = [];

  for (const a of annotations) {
    if (!hasNote(a)) continue;
    rows.push({ at: a.updatedAt, id: a.id, kind: "note", raw: a.note });
  }
  for (const r of restatements) {
    if (!r.text.trim()) continue;
    rows.push({ at: r.createdAt, id: r.id, kind: "restatement", raw: r.text });
  }

  // 时间倒序；同刻按 id 升序 —— 排序完全确定（同数据同结果，便于断言与复现）。
  rows.sort((a, b) => (b.at !== a.at ? b.at - a.at : a.id < b.id ? -1 : 1));

  const samples: MemorySample[] = [];
  const seen = new Set<string>();
  let totalChars = 0;
  let truncated = false;

  for (const row of rows) {
    if (samples.length >= MEMORY_LIMITS.sampleMaxItems) {
      truncated = true;
      break;
    }
    const masked = maskPii(row.raw).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (!masked) continue;

    // 批内去重：同一条笔记/复述重复出现（用户重述同一件事）只留最新的一条。
    // ⚠️ 这里**不做跨轮去重**（「已经写进文档的原文片段」无法匹配 —— 文档只存归纳句、
    // 不存原文，见方案 R4）；跨轮重复由回传给模型的「已记下的观察」清单拦截。
    const fingerprint = normalizeMemoryText(masked);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const clipped = masked.length > MEMORY_LIMITS.sampleItemChars;
    const text = clipped ? masked.slice(0, MEMORY_LIMITS.sampleItemChars) : masked;
    if (clipped) truncated = true;

    if (totalChars + text.length > MEMORY_LIMITS.sampleChars) {
      truncated = true;
      break;
    }
    totalChars += text.length;
    samples.push({ kind: row.kind, id: row.id, text });
  }

  return { samples, totalChars, truncated };
}

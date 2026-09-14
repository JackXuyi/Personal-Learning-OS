/**
 * 答案正文里 `[n]` 引用标记的切分（纯函数，零 React）。
 *
 * 为什么单独成文件：`ChapterQaPanel.tsx` 是 JSX 文件，node 的
 * `--experimental-strip-types` **不支持 JSX**，把切分逻辑留在 `.tsx` 里就无法
 * 直跑单测（TC-EDGE-11）。抽到 `.ts` 后即可零 DOM 断言。
 *
 * 口径（与方案 §7.3「不做隐式兜底」一致）：越界下标（`n > citationCount`
 * 或 `n < 1`）**原样当普通文本**，不替换、不报错、不崩。
 */

export interface QaTextSegment {
  text: string;
  /**
   * 引用序号（1-based，与 `QaCitation[]` 下标 +1 对应）；
   * `undefined` = 普通文本。
   */
  citation?: number;
}

/**
 * 把 `text` 按 `[n]` 标记切成片段。
 *
 * @param text          答案正文（可含 `[1][2]` 标记）
 * @param citationCount 实际可用的引用条数（用于越界判定）
 */
export function splitCitationMarkers(
  text: string,
  citationCount: number,
): QaTextSegment[] {
  const out: QaTextSegment[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const n = Number(match[1]);
    const inRange = Number.isFinite(n) && n >= 1 && n <= citationCount;
    if (!inRange) continue; // 越界 → 留作普通文本（下面兜底整段输出）
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    out.push({ text: match[0], citation: n });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

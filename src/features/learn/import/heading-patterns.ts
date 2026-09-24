/**
 * 「疑似标题行」判据的**唯一真源**（PDF 版式后处理 与 DOCX 输出层共用）。
 *
 * 2026-09-23（F8 范围 3）从 `pdf-layout.ts` 的私有常量迁出：DOCX 的「编号兜底层」
 * 必须与 PDF 用同一把尺子，否则同一份内容转 PDF 与转 DOCX 会切出不同章节数。
 *
 * ⚠️ 常量与正则**逐字搬迁**（含字符类顺序）—— 改一个字符就是行为变更。
 * ✅ 零行为变更的证据：`tests/import-extract.test.ts` 中 `promotePdfHeadings`
 *    的 3 条既有断言一字未改仍全绿。
 */

/** 疑似标题行：中文序号章名（第 X 章）/ Chapter N / 数字编号小节。 */
export const HEADING_PATTERNS: readonly RegExp[] = [
  /^第\s*[一二三四五六七八九十百千零两0-9]{1,6}\s*[章节篇部讲]\s*\S/,
  /^chapter\s+\d{1,3}\b/i,
  /^\d{1,2}(\.\d{1,2}){1,3}\s+\S/,
];

/** 是否命中编号形态（三层之外的最后兜底）。 */
export function isNumberedHeading(line: string): boolean {
  return HEADING_PATTERNS.some((re) => re.test(line));
}

/**
 * 标题的外围形状护栏（**入参须已 trim**）：
 * 非空、≤40 字符、不以 `#` 开头、不以句末/分隔标点结尾。
 *
 * ⚠️ 四条判断原样迁出 `promotePdfHeadings` 的内联写法（短路顺序未变）；
 * DOCX 侧复用同一函数 —— 长度阈值与标点集不允许出现第二份副本。
 */
export function isHeadingShape(line: string): boolean {
  if (!line) return false;
  if (line.length > 40) return false;
  if (line.startsWith("#")) return false;
  if (/[。！？；，]$/.test(line)) return false;
  return true;
}

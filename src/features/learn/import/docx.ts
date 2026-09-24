/**
 * DOCX 抽取编排（F8 范围 3）。
 *
 * 职责只有三件：**魔数判定 → 取 AST → 产 Markdown 并做语义化错误归一化**。
 * 解析细节在 `mammoth-reader.ts`（mammoth 接触面）与 `docx-markdown.ts`（输出层）。
 *
 * 错误用 **class + `name`**（对齐 `pdf.ts` 的 `PdfNoTextError` 模式），且**不携带用户文案**（G2）：
 * 本模块只产出语义类别，UI 按 `kind` 取 i18n（`import/error-text.ts`）。
 */
import { LIMITS } from "./types";
import { readDocumentNodes } from "./mammoth-reader";
import { docxNodesToMarkdown } from "./docx-markdown";
import type { DocxMarkdownResult, MammothNode } from "./docx-markdown";

/**
 * OLE 复合文档魔数：**前 4 个字节，按文件里出现的顺序**。
 * 老 `.doc` 与 Office 加密容器都以它开头。
 *
 * ⚠️ 刻意用字节序列而不是一个 u32 常量：`0xd0cf11e0` 是这 4 个字节按**大端**读出的数字，
 *    而小端读出的值是 `0xe011cfd0` —— 写成 u32 常量极易与字节顺序搞混，且错了**不会报错**、
 *    只会让魔数判定静默失效（本方案的初版就是这么写的，被单测抓住）。
 */
const OLE_MAGIC_BYTES = [0xd0, 0xcf, 0x11, 0xe0];

function hasOleMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && OLE_MAGIC_BYTES.every((byte, i) => bytes[i] === byte);
}

/** 旧版 `.doc`（OLE 二进制）或加密文档。 */
export class DocxLegacyError extends Error {
  constructor(message = "OLE compound file (legacy .doc or encrypted)") {
    super(message);
    this.name = "DocxLegacyError";
  }
}

/** 不是合法压缩包 / 压缩包损坏 / 缺 `word/document.xml`。 */
export class DocxBadArchiveError extends Error {
  constructor(message = "not a valid .docx archive") {
    super(message);
    this.name = "DocxBadArchiveError";
  }
}

/** 抽取不到任何文本（空文档或纯图片文档）。 */
export class DocxNoTextError extends Error {
  constructor(message = "no extractable text in .docx") {
    super(message);
    this.name = "DocxNoTextError";
  }
}

/** 正文超出字符护栏（解压后进内存，故与 PDF 同为「两端夹住」的另一端）。 */
export class DocxTooLargeError extends Error {
  constructor(chars: number) {
    super(`docx text length ${chars} exceeds limit (${LIMITS.docxMaxChars})`);
    this.name = "DocxTooLargeError";
  }
}

/**
 * 抽取 `.docx` 正文为 Markdown。失败抛上面的语义化错误（由 `local-files.ts` 映射为 `kind`）。
 *
 * ⚠️ 魔数判定放在最前：`.doc` 改名成 `.docx` 是常见误用，OLE 魔数是**可行动**的强证据
 *    （提示「用 Word 另存为 .docx」），比笼统的「不是有效 .docx」有用得多。
 * ⚠️ 字符护栏在此处而非调用方：护栏跟着抽取器走，任何调用方都拿不到超限正文
 *    （上限常量仍只有 `types.ts::LIMITS` 一处定义）。
 */
export async function extractDocxMarkdown(buffer: ArrayBuffer): Promise<DocxMarkdownResult> {
  const bytes = new Uint8Array(buffer);
  if (hasOleMagic(bytes)) throw new DocxLegacyError();

  let nodes: readonly MammothNode[];
  try {
    nodes = await readDocumentNodes(buffer);
  } catch {
    // mammoth / jszip 的异常形状不稳定（实测有 "Can't find end of central directory…"），
    // 一律归一化为「压缩包不合法」；detail 由调用方按需补文件名。
    throw new DocxBadArchiveError();
  }

  const result = docxNodesToMarkdown(nodes);
  if (!result.text.trim()) throw new DocxNoTextError();
  if (result.text.length > LIMITS.docxMaxChars) throw new DocxTooLargeError(result.text.length);
  return result;
}

/**
 * EPUB 抽取编排（F8 范围 4）。
 *
 * 链路：`openEpub`（归档层）→ 按 `spine` 顺序逐项 → `decodeBytes`（D4 编码嗅探）
 * → `parseHtml`（注入，D7）→ `htmlNodesToMarkdown`（输出层，零改动复用）
 * → 拼接 → 护栏 → `EpubExtractResult`。
 *
 * ⚠️ **不 import `jszip`**：归档细节全在 `epub-archive.ts`。
 *    本模块与 `web-page.ts` 同为「纯逻辑层」——生产喂 `browserHtmlParser`、
 *    单测喂 `linkedom` 的 `parseHTML`，node 可直跑。
 *
 * 错误用 **class + `name`**（对齐 `docx.ts` / `pdf.ts` 模式），且**不携带用户文案**（G2）：
 * 本模块只产出语义类别，UI 按 `kind` 取 i18n（`import/error-text.ts`）。
 *
 * 设计依据：docs/epub-import-design-2026-10.md §4 / §6（D2 / D3 / D4 / D6 / D7）。
 */
import { LIMITS } from "./types";
import { decodeBytes } from "./decode";
import { htmlNodesToMarkdown } from "./html-markdown";
import {
  decodeXmlEntities,
  entryPath,
  openEpub,
  readEntryBytes,
} from "./epub-archive";
import type { HtmlParser } from "./html-parse";

/** 抽不到任何正文（空书 / 纯图片排版 / 固定版式）。 */
export class EpubNoTextError extends Error {
  constructor(message = "no extractable text in .epub") {
    super(message);
    this.name = "EpubNoTextError";
  }
}

/** 解压总量或入库正文超限（两端夹住：防 zip bomb / 防撑爆存储）。 */
export class EpubTooLargeError extends Error {
  constructor(message = "epub exceeds size limits") {
    super(message);
    this.name = "EpubTooLargeError";
  }
}

/** 可注入的护栏（测试用小值验证；生产走 `LIMITS`）。 */
export interface EpubLimits {
  /** 入库正文字符上限（与 `LIMITS.epubMaxChars` 同一把尺子）。 */
  epubMaxChars: number;
  /** 解压后总字节上限（防 zip bomb，与文件字节线**不是**同一把尺子）。 */
  epubUnzippedBytes: number;
  /**
   * 无正文标题的 spine 项，正文短于此值时**并入前章**（避免切出大量碎片章）。
   * 与切分引擎 `minBodyCharsPerChapter` 默认值同量级（200），但**用途不同**：
   * 那个是切章下限，这个是「要不要给它单独成章」的判据。
   */
  minItemChars: number;
}

/** 依赖注入（与 `web-page.ts::WebUnitDeps` 同款）。 */
export interface EpubDeps {
  /** HTML 解析器（生产＝`browserHtmlParser`；单测＝`linkedom` 的 `parseHTML`）。 */
  parseHtml: HtmlParser;
}

/** 抽取结果（供 `local-files.ts` 组装 `ImportUnit`）。 */
export interface EpubExtractResult {
  /** 归一化 Markdown 正文（spine 顺序拼接，块间空行）。 */
  text: string;
  /** `dc:title`（可能缺；仅作资料标题兜底，D8）。 */
  bookTitle?: string;
  /** 产出的 `#` 标题数（含兜底补的）。 */
  headings: number;
  /** GFM 表格数。 */
  tables: number;
  /** 跳过的图片数（**不内联** base64，与 DOCX 先例一致）。 */
  skippedImages: number;
  /** 实际处理的正文章节数（去重后的 spine 项数），供结果卡展示。 */
  spineCount: number;
  /**
   * 采用过的**非 utf-8** 编码（去重）。仅当出现非 utf-8 时才有值 ——
   * 仓库纪律「不做静默兜底」（G4）：用户要能看到「已按 gb18030 解码」。
   */
  encodings?: string[];
}

/** 可作为正文的 media-type（部分工具产出 `text/html`）。 */
const XHTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);

/** epub 默认护栏（`LIMITS` 是唯一常量出处）。 */
const DEFAULT_LIMITS: EpubLimits = {
  epubMaxChars: LIMITS.epubMaxChars,
  epubUnzippedBytes: LIMITS.epubUnzippedBytes,
  minItemChars: 200,
};

/**
 * jszip 返回的 `Uint8Array` 可能共享更大的底层 buffer（`byteOffset !== 0`），
 * 直接取 `.buffer` 会把无关字节一起交给解码器 ⇒ 必须切出精确区间。
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** 从 XHTML 源串取 `<title>`（正文无标题时的二级兜底，D3）。 */
function docTitleOf(html: string): string | undefined {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const text = decodeXmlEntities(raw ?? "").trim().replace(/\s+/g, " ");
  return text || undefined;
}

/**
 * 抽取 `.epub` 为 Markdown。
 *
 * 标题三级兜底（D3，收敛结论：**宁可少一章也不造假章**）：
 * 1. 正文自带 `h1`–`h6` → 由输出层归一化，天然成章；
 * 2. 正文无标题但有 `<title>` 且正文 ≥ `minItemChars` → 补 `# <title>` 独立成章；
 * 3. 都没有（或过短）→ **并入前一章**，绝不生成「第 N 部分」这类占位标题
 *    （那等于把用户可见文案塞进数据层）。
 *
 * ⚠️ 第 3 档有个例外：**全书第一项**若也无标题，仍用 `<title>` 起头（若有），
 *    否则整本可能一章都切不出来；连 `<title>` 都没有才会真正「无章」。
 */
export async function extractEpubMarkdown(
  buffer: ArrayBuffer,
  deps: EpubDeps,
  limits?: Partial<EpubLimits>,
): Promise<EpubExtractResult> {
  const conf: EpubLimits = { ...DEFAULT_LIMITS, ...limits };
  const pkg = await openEpub(buffer);

  const blocks: string[] = [];
  let headings = 0;
  let tables = 0;
  let skippedImages = 0;
  let spineCount = 0;
  let unzipped = 0;
  const encodings = new Set<string>();

  for (const idref of pkg.spine) {
    const item = pkg.manifest.get(idref);
    // manifest 里查不到 idref（坏书）⇒ 跳过该项，不让整本失败。
    if (!item) continue;
    // 只处理正文类条目；无 media-type 时按扩展名判。
    if (item.mediaType) {
      if (!XHTML_TYPES.has(item.mediaType)) continue;
    } else if (!/\.x?html?$/i.test(item.href)) {
      continue;
    }

    const bytes = await readEntryBytes(pkg, entryPath(pkg, item));
    if (!bytes) continue;

    unzipped += bytes.length;
    if (unzipped > conf.epubUnzippedBytes) {
      throw new EpubTooLargeError(`unzipped>${conf.epubUnzippedBytes}`);
    }

    const decoded = decodeBytes(toArrayBuffer(bytes));
    encodings.add(decoded.encoding);

    // ⚠️ `parseHtml` 用 `text/html`（不是 `application/xml`）：真实 epub 里
    //    未闭合标签并不少见，XML 模式会直接判失败；HTML 模式容错且语义一致。
    const dom = deps.parseHtml(decoded.text);
    const root = dom.body ?? dom.documentElement;
    if (!root) continue;

    const md = htmlNodesToMarkdown(root);
    let text = md.text;
    if (!text.trim()) continue;

    spineCount += 1;
    tables += md.tables;
    skippedImages += md.skippedImages;

    if (md.headings === 0) {
      const title = docTitleOf(decoded.text);
      const longEnough = text.length >= conf.minItemChars;
      if (title && (longEnough || blocks.length === 0)) {
        text = `# ${title}\n\n${text}`;
        headings += 1;
      } else if (blocks.length > 0) {
        // D3 第 3 档：无标题且过短 ⇒ 并入前一章（不造占位章）。
        blocks[blocks.length - 1] += `\n\n${text}`;
        continue;
      }
    } else {
      headings += md.headings;
    }

    blocks.push(text);
  }

  const joined = blocks.join("\n\n").trim();
  if (!joined) throw new EpubNoTextError();
  if (joined.length > conf.epubMaxChars) {
    throw new EpubTooLargeError(`chars>${conf.epubMaxChars}`);
  }

  // 只在「出现过非 utf-8」时回报：纯 utf-8 不需要打扰用户。
  const needsEncodingHint = [...encodings].some((e) => e !== "utf-8");

  return {
    text: joined,
    bookTitle: pkg.title,
    headings,
    tables,
    skippedImages,
    spineCount,
    encodings: needsEncodingHint ? [...encodings] : undefined,
  };
}

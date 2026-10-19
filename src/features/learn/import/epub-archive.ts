/**
 * EPUB 归档层 —— `jszip` 的**唯一接触面**（F8 范围 4）。
 *
 * 职责边界：只把「一个 epub 字节流」变成**纯数据结构**（OPF 路径 / 标题 / manifest / spine），
 * 外加按路径读条目字节。**不产 Markdown、不碰 DOM、不做护栏** —— 那些在 `epub.ts`。
 *
 * 为什么要隔离（同 `mammoth-reader.ts` 的思路）：将来若把 `jszip` 换成 `fflate`，
 * 只改本文件一个。`tests/import-epub.test.ts` 的 H 组用源码断言锁死这条边界。
 *
 * 错误**不携带用户文案**（G2）：只抛语义化 class，由 `local-files.ts` 映射为 `kind`。
 *
 * 设计依据：docs/epub-import-design-2026-10.md §5（D1 / D5 / D7）。
 */
import JSZip from "jszip";

/** ZIP 本地文件头魔数 `PK\x03\x04`。 */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
/** 空归档 `PK\x05\x06`（只有中央目录结束记录）—— 同样不是有效 epub。 */
const ZIP_EMPTY_MAGIC = [0x50, 0x4b, 0x05, 0x06];

/** OCF 规定的容器描述文件（固定路径，大小写不敏感查找）。 */
const OCF_CONTAINER = "META-INF/container.xml";
/** 加密声明文件；**存在不等于 DRM**（见 `detectTextDrm`）。 */
const OCF_ENCRYPTION = "META-INF/encryption.xml";

/**
 * 字体混淆算法 URI（`http://www.idpf.org/2008/embedding`）。
 * ⚠️ 这是**正常现象**：大量正版书只混淆内嵌字体，正文完全不加密。
 *    一刀切按「有 encryption.xml 就拒绝」会误杀这些书（方案 D5）。
 */
const FONT_OBFUSCATION = "idpf.org/2008/embedding";

/** 不是合法压缩包 / 缺 container.xml / 缺 OPF / spine 为空。 */
export class EpubBadArchiveError extends Error {
  constructor(message = "not a valid .epub archive") {
    super(message);
    this.name = "EpubBadArchiveError";
  }
}

/** 正文被加密（DRM）——只报错，**不尝试解密**（方案 D5 / §1.3）。 */
export class EpubDrmError extends Error {
  constructor(message = "epub content is encrypted (DRM)") {
    super(message);
    this.name = "EpubDrmError";
  }
}

/** OPF `manifest` 里的一条（只留本方案用得到的字段）。 */
export interface EpubManifestItem {
  id: string;
  /** 相对 OPF 目录的原始 href（可能含 `%20` 或 `../`，未归一）。 */
  href: string;
  mediaType?: string;
  properties?: string;
}

/** 解包后的 epub 结构（纯数据 + zip 句柄）。 */
export interface EpubPackage {
  /** OPF 在归档内的完整路径（已归一）。 */
  opfPath: string;
  /** OPF 所在目录（拼接 spine 条目的 href 用；根目录时为空串）。 */
  opfDir: string;
  /** `dc:title`（可能缺；仅作资料标题兜底，方案 D8）。 */
  title?: string;
  manifest: Map<string, EpubManifestItem>;
  /** spine 的 idref 顺序（作者给定的阅读顺序）。 */
  spine: string[];
  /** 已解包的 zip 句柄，供 `epub.ts` 逐条目读字节。 */
  zip: JSZip;
}

/** 纯函数：前 4 字节是否为 ZIP 本地文件头（空归档也拒）。 */
export function hasZipMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const at = (magic: number[], offset = 0) => magic.every((b, i) => bytes[offset + i] === b);
  return at(ZIP_MAGIC) && !at(ZIP_EMPTY_MAGIC);
}

/**
 * 路径归一：消掉 `.` / `..` / 空段。
 * ⚠️ 不能直接用 `new URL` —— OPF 里的 href 是**归档内相对路径**，不是 URL。
 */
function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** `%20` 这类转义在 OPF 里合法但归档条目名是解码后的；解码失败则原样用。 */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/**
 * 按路径找条目：先精确，再**大小写不敏感回退**。
 * ⚠️ zip 条目名大小写敏感，但真实 epub 里 `OEBPS/` 与 `oebps/` 混用极常见；
 *    不做回退会让一批合法书报「缺 OPF」。
 */
function findEntry(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = zip.file(path);
  if (direct) return direct;
  const lower = path.toLowerCase();
  const hit = Object.keys(zip.files).find((k) => k.toLowerCase() === lower && !zip.files[k].dir);
  return hit ? zip.file(hit) : null;
}

/** 从标签属性串里取属性值（容忍双引号 / 单引号）。 */
function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs);
  return m?.[1];
}

/** XML 实体解码（`&amp;` 最后解，避免二次解码）。导出供 `epub.ts` 复用。 */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** 取某标签的文本内容（`<dc:title>` 与 `<title>` 各自精确匹配，互不串味）。 */
function tagText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const raw = re.exec(xml)?.[1]?.trim();
  return raw ? decodeXmlEntities(raw) : undefined;
}

/**
 * 解析 OPF。
 *
 * ⚠️ 刻意**不引 XML 解析器**（方案 §5.3）：所需字段固定，正则足够；
 *    `linkedom` 是 devDependency（生产不可用），webview 的 `DOMParser` 又不能在此层用
 *    （本模块要 node 可测）；新增 `fast-xml-parser` 与「零新增包」目标冲突。
 *    代价是要容忍两种闭合（`/>` 与 `></item>`）—— 用 `[^>]*?\/?>` 同时覆盖。
 */
function parseOpf(xml: string): {
  title?: string;
  manifest: Map<string, EpubManifestItem>;
  spine: string[];
} {
  // ⚠️ `dc:title` 优先：裸 `<title>` 会命中 XHTML 里的标题，OPF 里其实少见；
  //    但个别工具产出的 OPF 确实用无前缀 `<title>`，故做二级兜底。
  const title = tagText(xml, "dc:title") ?? tagText(xml, "title");

  const manifest = new Map<string, EpubManifestItem>();
  for (const m of xml.matchAll(/<item\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], "id");
    const href = attr(m[1], "href");
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: attr(m[1], "media-type"),
      properties: attr(m[1], "properties"),
    });
  }

  const spine: string[] = [];
  for (const m of xml.matchAll(/<itemref\b([^>]*?)\/?>/g)) {
    const idref = attr(m[1], "idref");
    if (idref) spine.push(idref);
  }

  return { title, manifest, spine };
}

/**
 * 正文是否被加密（DRM）。
 *
 * 判定细节（方案 D5）：
 * - `encryption.xml` 不存在 ⇒ 否；
 * - 逐 `<EncryptedData>` 看：算法是字体混淆 ⇒ **跳过这一条**（正常书）；
 * - 否则看 `CipherReference URI` 是否指向 xhtml/html ⇒ 是则判 DRM。
 *
 * ⚠️ 空 `<encryptionData>` 容器（有文件无条目）同样视为无 DRM。
 */
export async function detectTextDrm(zip: JSZip): Promise<boolean> {
  const entry = findEntry(zip, OCF_ENCRYPTION);
  if (!entry) return false;

  let xml: string;
  try {
    xml = await entry.async("string");
  } catch {
    // 读不出来无法判断 ⇒ 不阻断（让后续正文抽取自己暴露问题）。
    return false;
  }

  for (const m of xml.matchAll(/<EncryptedData\b[\s\S]*?<\/EncryptedData>/g)) {
    const block = m[0];
    const algorithm = attr(block, "Algorithm") ?? "";
    if (algorithm.includes(FONT_OBFUSCATION)) continue;

    const uri = /<CipherReference\b[^>]*\bURI\s*=\s*["']([^"']*)["']/i.exec(block)?.[1] ?? "";
    if (/\.x?html?$/i.test(uri)) return true;
    // 少数工具不写 URI 而是靠 media-type 声明。
    if (/application\/xhtml\+xml/i.test(block)) return true;
  }
  return false;
}

/**
 * 打开 epub：魔数 → 解包 → container.xml → OPF → 结构 + DRM 判定。
 *
 * 失败抛 `EpubBadArchiveError` / `EpubDrmError`（不含用户文案）。
 */
export async function openEpub(buffer: ArrayBuffer): Promise<EpubPackage> {
  const bytes = new Uint8Array(buffer);
  if (!hasZipMagic(bytes)) throw new EpubBadArchiveError("missing zip magic");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    // jszip 的异常形状不稳定（同 docx.ts 的处置）⇒ 一律归一为「压缩包不合法」。
    throw new EpubBadArchiveError("zip load failed");
  }

  const containerEntry = findEntry(zip, OCF_CONTAINER);
  if (!containerEntry) throw new EpubBadArchiveError("missing META-INF/container.xml");

  const containerXml = await containerEntry.async("string");
  const opfPathRaw = /<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i.exec(containerXml)?.[1];
  if (!opfPathRaw) throw new EpubBadArchiveError("container.xml has no rootfile");

  const opfPath = normalizePath(decodeHref(opfPathRaw));
  const opfEntry = findEntry(zip, opfPath);
  if (!opfEntry) throw new EpubBadArchiveError(`missing OPF: ${opfPath}`);

  const opfXml = await opfEntry.async("string");
  const { title, manifest, spine } = parseOpf(opfXml);
  if (spine.length === 0) throw new EpubBadArchiveError("empty spine");

  if (await detectTextDrm(zip)) throw new EpubDrmError();

  const slash = opfPath.lastIndexOf("/");
  const opfDir = slash >= 0 ? opfPath.slice(0, slash) : "";

  return { opfPath, opfDir, title, manifest, spine, zip };
}

/** manifest 条目 → 归档内完整路径（相对 OPF 目录归一）。 */
export function entryPath(pkg: EpubPackage, item: EpubManifestItem): string {
  return normalizePath(`${pkg.opfDir}/${decodeHref(item.href)}`);
}

/** 读条目字节；条目不存在返回 `undefined`（缺章节不该让整本书失败）。 */
export async function readEntryBytes(
  pkg: EpubPackage,
  path: string,
): Promise<Uint8Array | undefined> {
  const entry = findEntry(pkg.zip, normalizePath(path));
  if (!entry) return undefined;
  return entry.async("uint8array");
}

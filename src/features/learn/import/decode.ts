/**
 * 本地文本文件解码（编码嗅探）—— 纯函数、零依赖。
 *
 * 为什么需要（G4）：`File.text()` 恒按 UTF-8 解码，而中文笔记的常见来源是
 * Windows 记事本 / 老编辑器导出的 **GBK / GB18030**，直接 UTF-8 解码会整篇乱码
 * 且无任何提示。本项目不引入 `iconv-lite` / `jschardet`，改用运行时自带的
 * `TextDecoder`（WHATWG Encoding 标准，浏览器与 Node 均支持 `gb18030` 标签）。
 *
 * 策略（按优先级）：
 * 1. **BOM 优先**：UTF-8 BOM / UTF-16LE / UTF-16BE —— 有 BOM 就是强证据，直接采信；
 * 2. **严格 UTF-8 试探**：`{ fatal: true }` 解码成功即认定 UTF-8（ASCII 亦归此）；
 * 3. **GB18030 兜底**：UTF-8 严格解码失败 → 视为 GBK 系（GB18030 是 GBK/GB2312 的超集）。
 *
 * 已知局限：极少数 GBK 字节序列恰好也是合法 UTF-8（多为生僻字/符号），会被判成 UTF-8。
 * 这属于启发式的固有代价；本函数把最终采用的编码名回传，供 UI 明示而非静默。
 */

/** 解码结果：文本 + 实际采用的编码名（用于向用户明示，不做静默兜底）。 */
export interface DecodedText {
  text: string;
  /** 实际采用的编码标签（`utf-8` / `utf-16le` / `utf-16be` / `gb18030`）。 */
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "gb18030";
}

/** 按编码标签解码；`fatal` 时非法字节直接抛错（用于 UTF-8 试探）。 */
function decode(bytes: Uint8Array, label: string, fatal = false): string {
  return new TextDecoder(label, { fatal }).decode(bytes);
}

/** 解码一段文件字节流为文本（见文件头策略说明）。 */
export function decodeBytes(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer);

  // 1) BOM：三字节 UTF-8 / 双字节 UTF-16 LE·BE
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decode(bytes.subarray(3), "utf-8"), encoding: "utf-8" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decode(bytes.subarray(2), "utf-16le"), encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decode(bytes.subarray(2), "utf-16be"), encoding: "utf-16be" };
  }

  // 2) 严格 UTF-8 试探：合法即 UTF-8（含纯 ASCII）
  try {
    return { text: decode(bytes, "utf-8", true), encoding: "utf-8" };
  } catch {
    // 落空 → 非 UTF-8
  }

  // 3) GB18030 兜底（GBK / GB2312 超集）
  try {
    return { text: decode(bytes, "gb18030"), encoding: "gb18030" };
  } catch {
    // 运行时缺少该标签（极少见）→ 最后一次非严格 UTF-8，保证不抛错、不阻断导入
    return { text: decode(bytes, "utf-8"), encoding: "utf-8" };
  }
}

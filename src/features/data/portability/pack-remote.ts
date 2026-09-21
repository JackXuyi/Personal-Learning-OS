/**
 * 知识包**远程拉取** —— 链接 → 文本（F10 · 方案 §8.6）。
 *
 * 只允许 `https:`，且体积有**双重护栏**（`Content-Length` 预检 + 读取中累积），
 * 与本地导入侧共用**同一个**上限常量（D7 ① 「一把尺子」）。
 *
 * ⚠️ 本模块**只负责取回文本**，**不做**解析与校验：`parsePack` 才是唯一入口 ——
 * 在这里顺手做一点校验，就会出现「第二套校验语义」（两边强度悄悄分叉）。
 */
import { PACK_HARD_MAX_BYTES, utf8BytesOf } from "./pack-format";

/** 可注入的 fetch（默认全局；单测替换为 mock，零真实网络）。 */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type PackRemoteErrorKind = "invalid" | "network" | "too-large" | "not-pack";

/**
 * 拉取错误（与 `GithubImportError` 同范式）。
 *
 * **不携带用户可见文案**：只带 `kind` + 语言中立的 `detail`（HTTP 状态 / 上限值 /
 * 超时）。文案由 UI 层按 `kind` 取 i18n。`message` 仅作排障兜底，不直接展示。
 */
export class PackRemoteError extends Error {
  readonly kind: PackRemoteErrorKind;
  constructor(kind: PackRemoteErrorKind, detail?: string) {
    super(detail ? `${kind}: ${detail}` : kind);
    this.name = "PackRemoteError";
    this.kind = kind;
  }
}

/**
 * 链接合法性：**只允许 https**。
 *
 * ⚠️ 刻意**不**允许 `http:` / `file:` / `data:` —— 明文传输与本地文件读取都不该由
 * 「导入一个分享包」这个动作触发（本地文件有自己的入口）。
 */
export function parsePackUrl(raw: string): { ok: true; url: string } | { ok: false; kind: "invalid" } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, kind: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, kind: "invalid" };
  return { ok: true, url: url.toString() };
}

/**
 * 取回包文本（`redirect: "follow"`：分享链接常是短链）。
 *
 * 体积护栏分两道：① `Content-Length` 预检（它天然是**字节**数，与 `maxBytes`
 * 同一把尺子，无需换算）；② 读取中累积 —— 有 body 时**流式**读取，超限立即
 * `cancel()`，不让 100 MiB 的 body 全量进内存。
 *
 * 无 body（单测 mock 的 `Response`）→ 退化为 `text()`，但**仍按同一字节口径**判长度
 * （不能因为拿不到流就跳过护栏）。
 */
export async function fetchPackText(
  fetchImpl: FetchLike,
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? PACK_HARD_MAX_BYTES; // ① 与导入侧**同一个**常量（一把尺子）
  const parsed = parsePackUrl(rawUrl);
  if (!parsed.ok) throw new PackRemoteError("invalid", "not-https");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(parsed.url, { signal: ac.signal, redirect: "follow" });
  } catch (err) {
    // 含 abort（超时）与 CORS 失败 —— 对用户都是「没拿到」
    throw new PackRemoteError("network", err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new PackRemoteError("network", `HTTP ${res.status}`);

  // ① Content-Length 预检 —— 它天然就是字节数，与 maxBytes 同一把尺子，无需任何换算
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PackRemoteError("too-large", `content-length ${declared}`);
  }

  // ② 读取中累积。有 body → 流式；无 body → text() 后按同一字节口径判长度。
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength; // Uint8Array 的真实字节数
      if (bytes > maxBytes) {
        await reader.cancel(); // 超限立即断流，不等 body 读完
        throw new PackRemoteError("too-large", `${bytes}>${maxBytes}`);
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    return parts.join("") + decoder.decode();
  }

  const text = await res.text();
  const textBytes = utf8BytesOf(text);
  if (textBytes > maxBytes) throw new PackRemoteError("too-large", `${textBytes}>${maxBytes}`);
  return text;
}

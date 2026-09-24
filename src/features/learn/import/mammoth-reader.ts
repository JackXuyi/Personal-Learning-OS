/**
 * mammoth 接入的**唯一接触面**（F8 范围 3，2026-09-23）。
 *
 * 为什么要有这一层：mammoth 有两条「文档说谎」的坑，散在调用方会到处踩 ——
 *
 * **① 入参形态在 Node 与浏览器没有交集**（实测 mammoth@1.12.3）：
 *   - Node（`lib/unzip.js`）   认 `{ path | buffer | file }`，**不认 `arrayBuffer`**
 *     —— 传 `{ arrayBuffer }` 直接 `Error: Could not find file in options`；
 *   - 浏览器（`browser/unzip.js`，由 package.json 的 `browser` 字段重定向）
 *     只认 `{ arrayBuffer }`。
 *   而我们自己的类型声明 `lib/index.d.ts` **只声明了后者**（`ArrayBufferInput`）——
 *   类型与运行时不一致，是「照着类型写、运行时炸」的典型。
 *   ⇒ 集中在此探测一次：生产（Tauri WebView / Vite 走 browser 字段）走 `arrayBuffer`，
 *     node 单测（走 lib 路径）走 `buffer`。
 *
 * **② 成品输出不能用**（见 `docs/library-import-docx-design-2026-09.md` §3.3c）：
 *   `convertToMarkdown` **不产 GFM 表格**（表格降级为逐行段落），`convertToHtml`
 *   有表格但 HTML→Markdown 在 Node 需 DOM（破坏「纯逻辑 node 直跑」纪律）。
 *   ⇒ 本模块只把 `transformDocument` 当**读取钩子**取文档 AST，
 *     成品输出**刻意丢弃**，Markdown 由 `docx-markdown.ts` 自己产。
 *
 * ⚠️ 用 `convertToHtml`（而非 `convertToMarkdown`）是刻意的：后者**不在
 *   `lib/index.d.ts` 里**（类型落后于实现，直接调会 TS2339）。既然两者输出都要丢弃，
 *   就选有类型的那个 —— 换来零 `as any`（符合本仓 `strict` 纪律）。
 */
import mammoth from "mammoth";
import type { MammothNode } from "./docx-markdown";

/**
 * 构造 mammoth 入参（**环境探测的唯一处**）。
 *
 * ⚠️ 用 `typeof window` 而不是 `process`：本仓 `tsconfig.types` 只有 `["vite/client"]`，
 *    实测 `process` 报 `TS2591: Cannot find name 'process'`（`lib` 含 `DOM`，`window` 类型安全）。
 * ⚠️ 返回型别写**显式字面量联合**，不引用 mammoth 的 `Input` —— 其 `BufferInput`
 *    依赖 `Buffer` 类型（本仓未引入 `@types/node` 的全局）。
 * ⚠️ 不切 `bytes.buffer`：`file.arrayBuffer()` 给出的就是精确长度的 `ArrayBuffer`，
 *    直接传递可省一次整篇拷贝（20MB 文档的峰值内存）。
 */
export function mammothInput(buffer: ArrayBuffer): { buffer: Uint8Array } | { arrayBuffer: ArrayBuffer } {
  // node（单测直跑）→ lib/unzip.js
  if (typeof window === "undefined") return { buffer: new Uint8Array(buffer) };
  // 浏览器 / Tauri WebView → browser/unzip.js
  return { arrayBuffer: buffer };
}

/** 轻量结构判定（避免把 `unknown` 硬断言成 AST 类型）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 取 DOCX 的文档 AST（块级节点数组）。
 *
 * 失败一律抛普通 `Error`：错误**语义**由 `docx.ts` 归一化（OLE / 坏压缩包 / 无文本），
 * 本模块不 import 错误类 —— 否则与 `docx.ts` 形成循环依赖。
 *
 * ⚠️ 依赖 `transformDocument` 的 AST 形状（`run.fontSize` 单位＝磅、`numbering.isOrdered`…）：
 *    这是**实测契约、非文档承诺**（`index.d.ts` 里 `transformDocument` 只声明为 `(element: any) => any`）。
 *    ⇒ 由 `tests/import-docx.test.ts` 的契约守卫锁住形状，mammoth 升级破坏时立刻变红。
 */
export async function readDocumentNodes(buffer: ArrayBuffer): Promise<readonly MammothNode[]> {
  let root: unknown = undefined;
  // ⚠️ 返回值刻意不接收：成品输出不在本仓契约内（见文件头 ②）。
  await mammoth.convertToHtml(mammothInput(buffer), {
    transformDocument: (doc: unknown) => {
      root = doc;
      return doc;
    },
  });
  // ⚠️ 排障文案一律英文（G2）：导入层不得出现中文串，否则 test:extract 的静态断言会红。
  if (!isRecord(root)) throw new Error("mammoth: transformDocument did not receive a document node");
  const children = root.children;
  if (!Array.isArray(children)) throw new Error("mammoth: document node has no children array");
  return children;
}

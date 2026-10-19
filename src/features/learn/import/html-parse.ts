/**
 * HTML 解析器注入点 —— 网页导入（F8 范围 5）与 EPUB 导入（F8 范围 4）共用。
 *
 * 生产＝webview 的全局 `DOMParser`；单测注入 `linkedom` 的 `parseHTML`
 * （两者产出的节点都满足 `html-markdown.ts::HtmlDomNode` 的结构约束）。
 *
 * ⚠️ 本模块**不 import 任何 DOM 库**：`browserHtmlParser` 声明为常量而非在函数内
 *    `new DOMParser()` —— node 下没有 `DOMParser` 全局，这样只有真正调用它时才会炸，
 *    单测永不调用 ⇒ 纯逻辑层在 node 可跑。
 */
export type HtmlParser = (html: string) => Document;

export const browserHtmlParser: HtmlParser = (html) =>
  new DOMParser().parseFromString(html, "text/html");

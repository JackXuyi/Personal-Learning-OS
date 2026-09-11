/**
 * Mermaid 图表块 —— 本方案**唯一**有副作用的地方。
 *
 * 三条硬约束（都有对应静态断言，见 `tests/render-mermaid.test.ts`）：
 * 1. **必须动态 import**：`mermaid.core.mjs` 虽只有 52 KB 门面，但内部会按图类型
 *    拉取几十个 chunk（全量约 3 MB）。静态 import 会把这些塞进主包（现主包已 1.3 MB）。
 *    因此这里只允许 `import("mermaid")`，**不允许** `from "mermaid"` 值导入。
 * 2. **必须自己吞掉异常**：`RenderErrorBoundary` 一旦接住错误，会把**整篇正文**
 *    降级成纯文本。单块语法错误绝不能连坐全篇 → 错误只落到本块 state。
 * 3. **源码容器常驻 DOM**（只切 `hidden`）：`highlightRange` 用 `TreeWalker` 累加
 *    文本节点长度来把 `textPreview` 的绝对偏移映射到 DOM。若图渲染时把源码文本从
 *    DOM 里抹掉，图之后的所有「知识点 → 原文」锚点都会整体失准。
 */
import { useEffect, useId, useState } from "react";
import { useI18n } from "../../../i18n";
import { Button } from "../../../components/ui/button";
import { MAX_MERMAID_SOURCE_CHARS, sanitizeSvgId } from "./mermaid-source";
import { MERMAID_BASE_CONFIG, readThemeVariables } from "./mermaid-theme";

/** mermaid 模块类型（仅类型位置引用，不产生运行时导入）。 */
type MermaidApi = typeof import("mermaid")["default"];

/**
 * 模块级单例：`initialize` 全进程只需一次，且能复用同一份 promise
 * 以避免同页多图并发触发多次下载。副作用不属 React 生命周期，故不放 store。
 */
let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((mod) => {
    const mermaid = mod.default;
    const read = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name);
    mermaid.initialize({
      ...MERMAID_BASE_CONFIG,
      // 主题色运行时从 main.css 的语义变量读 → 本模块零 hex（rules/react.mdc）
      themeVariables: readThemeVariables(read),
      fontFamily: read("--font-sans").trim() || undefined,
    });
    return mermaid;
  });
  return mermaidPromise;
}

type ErrorReason = "syntax" | "too-large" | "load";

type BlockState =
  | { phase: "loading" }
  | { phase: "done"; svg: string }
  | { phase: "error"; reason: ErrorReason; detail?: string };

/** 取异常首行并截断 —— mermaid 的报错常带多行堆栈，整段塞进 UI 会撑爆块高。 */
function firstLine(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const line = raw
    .split("\n")
    .map((piece) => piece.trim())
    .find((piece) => piece.length > 0);
  if (!line) return "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

export interface MermaidBlockProps {
  /** **已规范化**的图源码（调用方负责 `normalizeMermaidSource`）。 */
  source: string;
}

export default function MermaidBlock({ source }: MermaidBlockProps) {
  const { m } = useI18n();
  const t = m.common.mermaid;
  const rawId = useId();
  // 超限 → **初值即错误态**：不进 effect、不加载 mermaid。
  const tooLarge = source.length > MAX_MERMAID_SOURCE_CHARS;

  const [state, setState] = useState<BlockState>(() =>
    tooLarge ? { phase: "error", reason: "too-large" } : { phase: "loading" },
  );
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (tooLarge) return;
    let cancelled = false;
    const id = sanitizeSvgId(rawId);

    void (async () => {
      let mermaid: MermaidApi;
      try {
        mermaid = await loadMermaid();
      } catch {
        if (!cancelled) setState({ phase: "error", reason: "load" });
        return;
      }
      try {
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) setState({ phase: "done", svg });
      } catch (err) {
        // 关键：**不外抛**。抛了会被 RenderErrorBoundary 接住 → 整篇正文降级纯文本。
        if (!cancelled) setState({ phase: "error", reason: "syntax", detail: firstLine(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, tooLarge, rawId]);

  const failed = state.phase === "error";
  // 错误态标题直接说明原因；成功态显示通用标签；加载态显示进行中。
  const header =
    state.phase === "loading"
      ? t.rendering
      : state.phase === "done"
        ? t.label
        : state.reason === "too-large"
          ? t.tooLarge(MAX_MERMAID_SOURCE_CHARS)
          : state.reason === "load"
            ? t.loadFailed
            : t.errorTitle;

  return (
    <div className="my-3 rounded-lg border border-line bg-surface p-3" data-testid="mermaid-block">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-3">{header}</span>
        {state.phase === "done" ? (
          <Button variant="ghost" size="sm" onClick={() => setShowSource((v) => !v)}>
            {showSource ? t.hideSource : t.viewSource}
          </Button>
        ) : null}
      </div>

      {state.phase === "loading" ? (
        <div className="h-32 rounded border border-dashed border-line bg-subtle" />
      ) : null}

      {state.phase === "done" ? (
        // 唯一注入点：内容只来自 mermaid.render 的返回值 —— securityLevel=strict
        // （HTML 编码 + click 禁用）+ 已剥离图内指令（不允许文档自行开 htmlLabels）。
        <div
          className="flex justify-center overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : null}

      {/* 源码容器：**常驻 DOM**，仅切 hidden —— 保证 highlightRange 的文本长度守恒 */}
      <pre
        data-mermaid-source=""
        className={`mt-2 overflow-x-auto rounded bg-subtle p-2 font-mono text-[12px] leading-5 text-ink-2 ${
          failed || showSource ? "" : "hidden"
        }`}
      >
        {source}
      </pre>

      {state.phase === "error" && state.reason === "syntax" && state.detail ? (
        <p className="mt-1 text-xs text-state-weak">{state.detail}</p>
      ) : null}
    </div>
  );
}

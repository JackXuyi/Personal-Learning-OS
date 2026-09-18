/**
 * 记忆文档查看态（F9 · §7.1）。
 *
 * 为什么**自绘列表行**而不是整篇 `react-markdown`：徽标（「你改过」「你写的」）必须
 * 贴在**行**上，而 markdown 渲染后原文行结构已经丢了。故这里按行分类自绘：
 * 标题 / 抬头引用块 / 列表行 / 普通段落 —— 前两类与骨架同形，列表行带徽标。
 *
 * ⚠️ 「你改过」的判据与合并器**完全一致**（`meta.lastWritten[key] !== 当前文本`）：
 * 页面显示「你改过」而合并器当成「系统原文」是最糟的不一致（用户会以为改过的行被覆盖了）。
 */
import { useI18n } from "../../i18n";
import type { MemoryDocMeta } from "../../domain";
import { keyMarkOf, sectionCategoryOf, stripListPrefix, MEMORY_KEY_MARK_RE } from "../../domain";

type Badge = "derived" | "ai" | "edited" | "manual";

type Block =
  | { kind: "h1" | "h2" | "text"; text: string; section?: boolean }
  | { kind: "quote"; lines: string[] }
  | { kind: "row"; text: string; badge: Badge };

/**
 * 徽标配色（仅用 `main.css` 的语义 token；状态色只用于徽标这种小面积元素，
 * 符合 `rules/react.mdc` 的「状态色仅 dot / 徽标」）。
 */
const BADGE_CLASS: Record<Badge, string> = {
  derived: "border border-line text-ink-3",
  ai: "bg-state-learning/15 text-state-learning",
  edited: "bg-state-weak/15 text-state-weak",
  manual: "bg-primary/15 text-primary",
};

export default function MemoryDocView({ doc, meta }: { doc: string; meta: MemoryDocMeta }) {
  const { m } = useI18n();
  const blocks = toBlocks(doc, meta);

  return (
    <div className="space-y-1" data-testid="memory-doc-view">
      {blocks.map((block, i) => {
        if (block.kind === "h1") {
          return (
            <h1 key={i} className="text-lg font-semibold text-ink-1">
              {block.text}
            </h1>
          );
        }
        if (block.kind === "h2") {
          return (
            <h2
              key={i}
              className={`${i === 0 ? "" : "mt-5"} flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-2`}
            >
              {block.text}
              {block.section ? (
                <span className="rounded px-1 py-0.5 text-[10px] font-normal border border-line text-ink-3">
                  {m.memory.rowBadge.derived}
                </span>
              ) : null}
            </h2>
          );
        }
        if (block.kind === "quote") {
          return (
            <div key={i} className="space-y-0.5 border-l-2 border-line pl-3 text-xs leading-relaxed text-ink-3">
              {block.lines.map((line, j) => (
                <p key={j}>{line}</p>
              ))}
            </div>
          );
        }
        if (block.kind === "row") {
          return (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span
                className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] ${BADGE_CLASS[block.badge]}`}
                title={m.memory.rowBadge[block.badge]}
              >
                {m.memory.rowBadge[block.badge]}
              </span>
              <span className="text-sm leading-relaxed text-ink-1">{block.text}</span>
            </div>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed text-ink-2">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

/**
 * 文档 → 渲染块。
 *
 * 徽标判定（与合并器同口径）：
 * - 无键（含键非法而降级的行）→ `manual`（你写的）；
 * - 有键且文本 ≠ `lastWritten[key]` → `edited`（你改过）；
 * - 键以 `ai-` 开头 → `ai`（模型归纳）；
 * - 其余 → `derived`（本地规则整理）。
 */
function toBlocks(doc: string, meta: MemoryDocMeta): Block[] {
  const blocks: Block[] = [];
  let quotes: string[] = [];

  const flushQuotes = () => {
    if (quotes.length > 0) blocks.push({ kind: "quote", lines: quotes });
    quotes = [];
  };

  for (const raw of doc.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushQuotes();
      continue;
    }
    if (/^\s*>/.test(line)) {
      quotes.push(line.replace(/^\s*>\s?/, ""));
      continue;
    }
    flushQuotes();

    const heading = /^\s*(#{1,6})\s*(.*)$/.exec(line);
    if (heading) {
      const section = sectionCategoryOf(line) !== undefined;
      const text = heading[2].replace(/<!--[^>]*-->$/g, "").trim();
      if (heading[1].length === 1) blocks.push({ kind: "h1", text });
      else blocks.push({ kind: "h2", text, section });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const key = keyMarkOf(line);
      const text = stripListPrefix(line.replace(MEMORY_KEY_MARK_RE, "").replace(/<!--[^>]*-->$/g, ""));
      const badge: Badge =
        !key
          ? "manual"
          : meta.lastWritten[key] !== undefined && meta.lastWritten[key] !== text
            ? "edited"
            : key.startsWith("ai-")
              ? "ai"
              : "derived";
      blocks.push({ kind: "row", text, badge });
      continue;
    }

    blocks.push({ kind: "text", text: line.trim() });
  }
  flushQuotes();
  return blocks;
}

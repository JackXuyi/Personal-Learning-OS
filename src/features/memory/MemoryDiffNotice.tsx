/**
 * 差异提示（F9 · §7.1）：用户改过 / 删过，而系统当前仍推出**不同**的值。
 *
 * 这块 UI 的存在意义不是「催用户采纳系统版本」，而是**让推测可见**：
 * 用户改过一行之后，系统仍可能在推另一个说法 —— 藏起来会让人以为系统「记住了」，
 * 摆出来 + 一个「用系统的版本」按钮，选择权就明确在用户手里（R1 的核心缓解手段）。
 *
 * ⚠️ `dismissed` 的行也在这里呈现（`mine === undefined`）—— 那是「你删掉了它，
 * 系统还在推」的诚实提示，同理不自动写回。
 */
import { useI18n } from "../../i18n";
import { Card, Section } from "../../components/primitives";
import { buttonVariants } from "../../components/ui/button";
import type { MemoryDiffEntry } from "./memory-doc-merge";

export default function MemoryDiffNotice({
  diffs,
  onUseSystem,
}: {
  diffs: readonly MemoryDiffEntry[];
  onUseSystem: (key: string, currentLine: string) => void;
}) {
  const { m } = useI18n();
  if (diffs.length === 0) return null;

  return (
    <Card className="space-y-3" data-testid="memory-diff-notice">
      <Section title={m.memory.diffTitle} />
      <ul className="space-y-3">
        {diffs.map((d) => (
          <li key={d.key} className="space-y-1">
            <p className="text-sm leading-relaxed text-ink-1">
              {d.mine === undefined
                ? m.memory.diffTheirs(d.theirs)
                : m.memory.diffMine(d.mine)}
            </p>
            {d.mine === undefined ? null : (
              <p className="text-sm leading-relaxed text-ink-3">{m.memory.diffTheirs(d.theirs)}</p>
            )}
            <button
              type="button"
              className={buttonVariants({ variant: "outline", size: "sm" })}
              data-testid={`memory-use-system-${d.key}`}
              // 被删掉的行没有「当前文本」→ 传空串，服务层据此只解除墓碑（见其注释）
              onClick={() => onUseSystem(d.key, d.mine ?? "")}
            >
              {m.memory.useSystem}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-3">{m.memory.diffNote}</p>
    </Card>
  );
}

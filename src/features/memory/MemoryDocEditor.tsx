/**
 * 记忆文档编辑态（F9 · §7.2）。
 *
 * 形态选择：**等宽 `textarea` 直接编辑 markdown 原文**，不做富文本。
 * 理由（方案 §13.1）：富文本会让「行尾标记要不要保留」变成一条无法向用户解释的
 * 规则；而「改文字」这个能力 `textarea` 已经完全够用 —— 用户看到的、改的就是真源。
 *
 * 保存策略：**600ms 防抖**（每敲一个字符写一次 `localStorage` 没必要）+ 保存成功后
 * 给一次「已保存」闪示。⚠️ 保存**不经过合并器**（用户文本必须逐字节落库）。
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";

const DEBOUNCE_MS = 600;
const FLASH_MS = 1_500;

export default function MemoryDocEditor({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (doc: string) => Promise<void>;
}) {
  const { m } = useI18n();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);

  // 外部文档变化（如自动整理、分析另一台设备载入）→ 同步进来；
  // ⚠️ 只在**用户没有未落库输入**时同步，避免把正在打的字冲掉。
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setText(initial);
  }, [initial]);

  useEffect(() => {
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current);
    };
  }, []);

  function onChange(next: string) {
    setText(next);
    dirty.current = true;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void onSave(next)
        .then(() => {
          dirty.current = false;
          setFailed(false);
          setSaved(true);
          flashTimer.current = window.setTimeout(() => setSaved(false), FLASH_MS);
        })
        .catch(() => setFailed(true));
    }, DEBOUNCE_MS);
  }

  return (
    <div className="space-y-2" data-testid="memory-doc-editor">
      <p className="text-xs leading-relaxed text-ink-3">{m.memory.editHint}</p>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        data-testid="memory-doc-textarea"
        className="h-[26rem] w-full resize-y rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink-1 outline-none focus:border-primary"
      />
      <div className="flex items-center gap-3 text-xs">
        {saved ? <span className="text-state-mastered">{m.memory.saved}</span> : null}
        {failed ? <span className="text-state-failed">{m.memory.err.saveFailed}</span> : null}
      </div>
    </div>
  );
}

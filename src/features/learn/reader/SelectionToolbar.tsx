/**
 * 选区浮动工具条（selection toolbar）—— 阅读页左栏正文的划线入口。
 *
 * 设计（docs/learn-highlight-note-design-2026-09.md §5.1 / §7.1）：
 * - **选区必须完全落在正文容器内**（`root.contains(commonAncestorContainer)`）：
 *   跨出正文的选区锚不回来，弹工具条等于制造无效入口。
 * - **笔记内联在工具条里**（`textarea` + 字数计数 + 取消/保存），不引入 Dialog ——
 *   与「低认知负荷」的产品意图一致。
 * - **不用 Toast**：所有失败反馈就近内联（沿用既有面板的「诚实降级」风格）。
 * - 本组件**不碰 storage**：props 进、回调出（`onCreate` 由页面注入服务层调用）。
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { ANNOTATION_LIMITS } from "../../../domain";
import type { AnnotationStatus } from "../annotation-service";
import { useI18n } from "../../../i18n";

interface SelectionToolbarProps {
  /** 正文容器（选区必须落在其中）。 */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** 相对定位宿主（工具条绝对定位的参照）。 */
  hostRef: React.RefObject<HTMLDivElement | null>;
  /** 提交（quote + note）→ 服务层结果；`ok` / `duplicate` 视为成功（工具条关闭）。 */
  onCreate: (quote: string, note: string) => Promise<{ status: AnnotationStatus }>;
}

interface SelectionState {
  quote: string;
  /** 相对宿主的坐标（选区正上方）。 */
  top: number;
  left: number;
  mode: "idle" | "note";
}

export default function SelectionToolbar({ rootRef, hostRef, onCreate }: SelectionToolbarProps) {
  const { m } = useI18n();
  const t = m.learn.reader.annotations;
  const [sel, setSel] = useState<SelectionState | undefined>();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  /** 工具条自身 —— 用于把「发生在工具条里的 mouseup」排除在选区重算之外。 */
  const toolbarRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setSel(undefined);
    setNote("");
    setMessage(undefined);
    window.getSelection()?.removeAllRanges();
  };

  /** 选区建立 → 弹工具条；选区塌陷 / 越界 / 超护栏 → 不弹（静默，不制造无效入口）。 */
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      // ⚠️ 必须排除「鼠标落在工具条内」的情形：点「划线并写笔记」也是一次 mouseup，
      // 此时选区通常仍未塌陷 → 若照常重算，就会把刚切到的笔记态**重置回 idle**，
      // 用户输到一半的笔记随之丢失（`setNote("")`）。这类「自己把自己关掉」的
      // 自触发在弹出式浮层里是常见坑。
      if (toolbarRef.current?.contains(e.target as Node)) return;

      const selection = window.getSelection();
      const root = rootRef.current;
      const host = hostRef.current;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      if (!root || !host) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;

      const quote = selection.toString().trim();
      if (quote.length < ANNOTATION_LIMITS.minQuoteChars) return;
      if (quote.length > ANNOTATION_LIMITS.maxQuoteChars) return;

      const rect = range.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      setSel({
        quote,
        top: rect.top - hostRect.top - 8,
        left: rect.left - hostRect.left + rect.width / 2,
        mode: "idle",
      });
      setNote("");
      setMessage(undefined);
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [rootRef, hostRef]);

  /** Esc = 关闭并清空选区（键盘可达性；与 §7.3 交互说明一致）。 */
  useEffect(() => {
    if (!sel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sel]);

  /** 状态码 → 文案（穷尽 switch：新增状态时 TS 会报未覆盖）。 */
  const statusText = (s: AnnotationStatus): string => {
    switch (s) {
      case "unanchored":
        return t.status.unanchored;
      case "duplicate":
        return t.status.duplicate;
      case "too-short":
        return t.status["too-short"];
      case "too-long":
        return t.status["too-long"];
      case "capped":
        return t.status.capped;
      case "no-body":
        return t.status["no-body"];
      default:
        return t.status.error;
    }
  };

  const submit = async (withNote: boolean) => {
    if (!sel) return;
    setBusy(true);
    try {
      const r = await onCreate(sel.quote, withNote ? note : "");
      // duplicate 也算成功：页面会滚到已有条目（幂等语义，不提示「失败」）。
      if (r.status === "ok" || r.status === "duplicate") {
        close();
        return;
      }
      setMessage(statusText(r.status));
    } finally {
      setBusy(false);
    }
  };

  if (!sel) return null;

  const overLimit = note.length > ANNOTATION_LIMITS.maxNoteChars;

  return (
    <div
      ref={toolbarRef}
      data-testid="reader-selection-toolbar"
      style={{ top: sel.top, left: sel.left }}
      className="absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface shadow-lg"
    >
      {sel.mode === "idle" ? (
        <div className="flex items-center gap-1 p-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid="reader-selection-mark"
            onClick={() => void submit(false)}
          >
            ▏{t.mark}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid="reader-selection-mark-note"
            onClick={() => setSel({ ...sel, mode: "note" })}
          >
            ▏{t.markWithNote}
          </Button>
        </div>
      ) : (
        <div className="w-64 space-y-1.5 p-2">
          <Textarea
            value={note}
            rows={3}
            autoFocus
            placeholder={t.notePlaceholder}
            data-testid="reader-annotation-note-input"
            onChange={(e) => setNote(e.target.value)}
            className="text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[11px] tabular-nums ${overLimit ? "text-destructive" : "text-ink-3"}`}
            >
              {t.noteCount(note.length, ANNOTATION_LIMITS.maxNoteChars)}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={close}>
                {t.cancel}
              </Button>
              <Button
                size="sm"
                disabled={busy || overLimit}
                data-testid="reader-annotation-note-save"
                onClick={() => void submit(true)}
              >
                {t.save}
              </Button>
            </div>
          </div>
        </div>
      )}

      {message ? (
        <p
          data-testid="reader-selection-message"
          className="max-w-72 border-t border-line px-2 py-1.5 text-[11px] leading-4 text-ink-2"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

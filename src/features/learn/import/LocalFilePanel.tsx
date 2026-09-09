/**
 * 本地文件来源面板（拖拽/点选 .md / .pdf，批量）。
 *
 * 职责（docs/knowledge-import-design-2026-09.md §7.2 / §8.6）：
 * - 收集用户选中的「可导入」文件（受控，files 由 ImportModal 持有，便于底部
 *   主按钮计数与批量执行）；本面板只做选择交互 + 即时预校验展示；
 * - 预校验（classifyLocalFile）：扩展名白名单 + 大小护栏即时标红，超限/不支持
 *   的行仅展示不进入可导入列表；「扫描件 PDF」预校验不可知，导入期由
 *   fileToUnit 判定并计入批量失败项。
 *
 * 导入动作由 ImportModal 底部主按钮统一触发（本面板不直接写 storage）。
 */
import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { useI18n } from "../../../i18n";
import { classifyLocalFile, formatBytes } from "./types";
import type { LocalFileClassified } from "./types";

interface LocalFilePanelProps {
  /** 当前可导入文件（受控；新增/移除都通过 onFilesChange 上抛）。 */
  files: File[];
  onFilesChange: (files: File[]) => void;
  /** 导入进行中禁用选择。 */
  disabled?: boolean;
}

/** 展示行：含预校验状态（ok / 超限 / 不支持）。 */
interface Row {
  file: File;
  state: LocalFileClassified | "unsupported";
}

export default function LocalFilePanel({ files, onFilesChange, disabled }: LocalFilePanelProps) {
  const { m } = useI18n();
  const fmt = m.learn.import;
  const inputRef = useRef<HTMLInputElement>(null);
  // 展示行与「可导入」文件解耦：本次会话选过的文件都留在列表（含被拒行）。
  const [rows, setRows] = useState<Row[]>(() => files.map((f) => ({ file: f, state: rowState(f) })));

  function rowState(file: File): Row["state"] {
    const cls = classifyLocalFile(file);
    return "error" in cls ? "unsupported" : cls;
  }

  /** 合并一批新文件：unsupported 行仅展示；超限行仅展示；可导入行进入 files。 */
  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    const added: Row[] = [];
    const valid: File[] = [...files];
    for (const file of incoming) {
      // 已存在同名同大小文件则跳过（避免重复导入同一文件）。
      if (files.some((f) => f.name === file.name && f.size === file.size)) continue;
      const state = rowState(file);
      added.push({ file, state });
      if (state !== "unsupported" && !state.overLimit) valid.push(file);
    }
    if (added.length === 0) return;
    setRows((prev) => [...prev, ...added]);
    onFilesChange(valid);
  }

  function removeRow(index: number) {
    const removed = rows[index];
    if (!removed) return;
    const nextRows = rows.filter((_, i) => i !== index);
    setRows(nextRows);
    // 被移除的行若是可导入文件，需同步从 files 中摘除。
    if (removed.state !== "unsupported" && !removed.state.overLimit) {
      onFilesChange(files.filter((f) => !(f.name === removed.file.name && f.size === removed.file.size)));
    }
  }

  function clearAll() {
    setRows([]);
    onFilesChange([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (disabled) return;
    addFiles(Array.from(e.dataTransfer.files));
  }

  const validCount = files.length;

  return (
    <div className="space-y-3" data-testid="local-file-panel">
      {/* 拖拽 / 点选区 */}
      <label
        data-testid="local-file-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={`block cursor-pointer rounded-xl border border-dashed border-line bg-subtle/40 px-4 py-6 text-center transition-colors ${
          disabled ? "opacity-50" : "hover:border-accent/60 hover:bg-subtle/70"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".md,.markdown,.mdown,.pdf"
          className="hidden"
          data-testid="local-file-input"
          disabled={disabled}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <p className="text-sm font-medium text-ink-1">{fmt.local.dropTitle}</p>
        <p className="mt-1 text-xs text-ink-3">{fmt.local.dropHint}</p>
      </label>

      {/* 已选列表 */}
      {rows.length > 0 ? (
        <div className="rounded-xl border border-line bg-surface/60 px-3 py-2">
          <div className="flex items-center justify-between px-1 py-1">
            <p className="text-xs font-medium text-ink-2">
              {fmt.local.selected(rows.length)}
              {validCount !== rows.length ? (
                <span className="ml-1.5 text-ink-3">
                  · {fmt.local.importable(validCount)}
                </span>
              ) : null}
            </p>
            <button
              onClick={clearAll}
              disabled={disabled}
              className="rounded px-1.5 py-0.5 text-xs text-ink-3 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-40"
            >
              {fmt.local.removeAll}
            </button>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {rows.map((row, i) => (
              <li
                key={`${row.file.name}-${row.file.size}`}
                data-testid={`local-file-chip-${i}`}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs"
              >
                <StatusIcon state={row.state} />
                <span className="min-w-0 flex-1 truncate text-ink-1">{row.file.name}</span>
                <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
                  {kindLabel(row.state)}
                </span>
                <span className="shrink-0 tabular-nums text-ink-3">{formatBytes(row.file.size)}</span>
                {row.state !== "unsupported" && row.state.overLimit ? (
                  <span className="shrink-0 text-state-weak">{fmt.local.tooLarge}</span>
                ) : null}
                {row.state === "unsupported" ? (
                  <span className="shrink-0 text-state-weak">{fmt.local.unsupported}</span>
                ) : null}
                <button
                  onClick={() => removeRow(i)}
                  disabled={disabled}
                  aria-label={fmt.local.remove}
                  className="shrink-0 rounded px-1 text-ink-3 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-40"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** 行状态图标：✓ 可导入 / ⚠ 超限 / ✕ 不支持。 */
function StatusIcon({ state }: { state: Row["state"] }) {
  if (state === "unsupported") return <span className="shrink-0 text-state-weak">✕</span>;
  if (state.overLimit) return <span className="shrink-0 text-state-weak">⚠</span>;
  return <span className="shrink-0 font-bold text-state-mastered">✓</span>;
}

/** 类型徽标文案：md → Markdown；pdf → PDF；其它 → 类型未知。 */
function kindLabel(state: Row["state"]): string {
  if (state === "unsupported") return "—";
  return state.kind === "pdf" ? "PDF" : "Markdown";
}

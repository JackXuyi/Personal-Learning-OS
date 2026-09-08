import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLoopStore } from "../stores/useLoopStore";
import { useSessionStore, type DoneRecord } from "../stores/useSessionStore";
import { actionKindLabel, unitTitle } from "../features/units";

/**
 * ⌘K 命令面板（S5 / P2-2）。
 *
 * 任意页面 ⌘K / Ctrl+K 唤起：输入过滤 · ↑↓ 选择 · Enter 执行 · Esc 关闭。
 * 首条「行动」恒在顶部——不知道做什么时，⌘K 后直接回车即可启动今日闭环。
 */

interface Command {
  id: string;
  label: string;
  hint?: string;
  section: "行动" | "跳转" | "最近";
  run: () => void;
  search: string;
}

/** 跳转项与侧边栏一一对应（不改路由）。 */
const NAV_ENTRIES: { to: string; label: string; hint?: string }[] = [
  { to: "/", label: "首页", hint: "今天做哪件事" },
  { to: "/learn", label: "学习", hint: "章节目录与阅读" },
  { to: "/quiz", label: "测评", hint: "试卷 · 出卷 · 答题" },
  { to: "/spaces", label: "学习空间", hint: "资料与空间" },
  { to: "/career", label: "职业", hint: "目标就绪度" },
  { to: "/settings", label: "设置", hint: "AI 服务" },
];

const REVIEW_LABEL: Record<DoneRecord["mode"], string> = {
  review: "复习",
  assessment: "测评",
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const snapshot = useLoopStore((s) => s.snapshot);
  const refresh = useLoopStore((s) => s.refresh);
  const recent = useSessionStore((s) => s.records);

  // 全局快捷键：⌘K / Ctrl+K 开合。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 打开时：聚焦输入框并清空上次关键词。
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open]);

  // 闭环快照缺失就先刷一次（保证「下一步」数据可用）；快照就绪后不打断输入。
  useEffect(() => {
    if (open && !snapshot) void refresh();
  }, [open, snapshot, refresh]);

  // 列表长度变化时钳制高亮下标。
  useEffect(() => {
    setActive(0);
  }, [query]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    // ── 行动 ──────────────────────────────────────────────
    const next = snapshot?.next;
    if (next) {
      list.push({
        id: "act-next",
        label: `开始今天的下一步 · ${actionKindLabel(next.kind)} ${unitTitle(next.unitId)}`,
        hint: "启动今日闭环",
        section: "行动",
        search: "开始 下一步 学习 复习 测评 今天 " + unitTitle(next.unitId),
        run: () => {
          const to =
            next.kind === "assessment"
              ? `/assessment?unit=${next.unitId}`
              : `/study/session?unit=${next.unitId}`;
          void refresh();
          navigate(to);
        },
      });
    }
    list.push({
      id: "act-import",
      label: "导入资料",
      hint: "粘贴 → 切分章节 → 逐章学习",
      section: "行动",
      search: "导入 资料 粘贴 章节 学习",
      run: () => navigate("/learn?import=1"),
    });

    // ── 跳转 ──────────────────────────────────────────────
    for (const nav of NAV_ENTRIES) {
      list.push({
        id: `nav-${nav.to}`,
        label: nav.label,
        hint: nav.hint,
        section: "跳转",
        search: nav.label + " " + (nav.hint ?? "") + " 页面 打开",
        run: () => navigate(nav.to),
      });
    }

    // ── 最近（今日已完成，会话内存态）──────────────────────
    const recentList = [...recent]
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
      .map<Command>((r) => ({
        id: `recent-${r.unitId}`,
        label: `${REVIEW_LABEL[r.mode]} · ${unitTitle(r.unitId)}`,
        hint: ago(r.at),
        section: "最近",
        search: unitTitle(r.unitId) + " 最近 继续",
        run: () =>
          navigate(
            r.mode === "assessment"
              ? `/assessment?unit=${r.unitId}`
              : `/study/session?unit=${r.unitId}`,
          ),
      }));
    list.push(...recentList);

    return list;
  }, [snapshot, recent, refresh, navigate]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.search.toLowerCase().includes(q));
  }, [commands, query]);

  const sections = useMemo(() => {
    const order: Command["section"][] = ["行动", "跳转", "最近"];
    return order
      .map((title) => ({ title, items: visible.filter((c) => c.section === title) }))
      .filter((s) => s.items.length > 0);
  }, [visible]);

  if (!open) return null;

  const close = () => setOpen(false);

  const runActive = () => {
    const cmd = visible[active];
    if (!cmd) return;
    close();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // 中文输入法组词回车不触发
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runActive();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="mx-auto mt-[10vh] w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-500">
            ⌘K
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="跳转或执行…"
            className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            aria-label="命令面板搜索"
            autoFocus
            spellCheck={false}
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">
            Esc
          </kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-2">
          {sections.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              没有匹配「{query}」的命令
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.title}>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </p>
                {section.items.map((cmd) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const isActive = index === active;
                  return (
                    <button
                      key={cmd.id}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => {
                        close();
                        cmd.run();
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors ${
                        isActive
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-700"
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        {cmd.section === "行动" ? "▶ " : ""}
                        {cmd.label}
                      </span>
                      {cmd.hint ? (
                        <span className="shrink-0 text-xs text-slate-400">
                          {cmd.hint}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** 「2 分钟前」样式的相对时间。 */
function ago(at: number): string {
  const diff = Math.max(0, Date.now() - at);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  return `${hour} 小时前`;
}

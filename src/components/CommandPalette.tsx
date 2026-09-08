import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLoopStore, storage } from "../stores/useLoopStore";
import { useSessionStore, type DoneRecord } from "../stores/useSessionStore";
import { unitTitle } from "../features/units";
import type { Chapter } from "../domain";
import { useI18n, type Messages } from "../i18n";
import {
  actionPath,
  chapterDisplayTitle,
  makeRetakePaper,
} from "../features/plan/chapter-action";

/**
 * ⌘K 命令面板（S5 / P2-2）。
 *
 * 任意页面 ⌘K / Ctrl+K 唤起：输入过滤 · ↑↓ 选择 · Enter 执行 · Esc 关闭。
 * 首条「行动」恒在顶部——不知道做什么时，⌘K 后直接回车即可启动今日闭环。
 */

type SectionKey = "action" | "jump" | "recent";

interface Command {
  id: string;
  label: string;
  hint?: string;
  section: SectionKey;
  run: () => void;
  search: string;
}

const SECTION_ORDER: SectionKey[] = ["action", "jump", "recent"];

/** 跳转项与侧边栏一一对应（不改路由；label/hint 取自当前语言字典）。 */
const NAV_ENTRIES = [
  "/",
  "/learn",
  "/plan",
  "/quiz",
  "/spaces",
  "/career",
  "/settings",
] as const;

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { m } = useI18n();

  const snapshot = useLoopStore((s) => s.snapshot);
  const chapterPlan = useLoopStore((s) => s.chapterPlan);
  const refresh = useLoopStore((s) => s.refresh);
  const recent = useSessionStore((s) => s.records);

  /** 章 id → Chapter（章级行动跳转用）。 */
  const chapterIndex = useMemo(() => {
    const index = new Map<string, Chapter>();
    for (const list of Object.values(chapterPlan?.chaptersByDoc ?? {})) {
      for (const c of list) index.set(c.id, c);
    }
    return index;
  }, [chapterPlan]);

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
    if (open && !snapshot && !chapterPlan) void refresh();
  }, [open, snapshot, chapterPlan, refresh]);

  // 列表长度变化时钳制高亮下标。
  useEffect(() => {
    setActive(0);
  }, [query]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    const navOf = (to: (typeof NAV_ENTRIES)[number]): string => {
      switch (to) {
        case "/": return m.nav.home.label;
        case "/learn": return m.nav.learn.label;
        case "/plan": return m.nav.plan.label;
        case "/quiz": return m.nav.quiz.label;
        case "/spaces": return m.nav.spaces.label;
        case "/career": return m.nav.career.label;
        case "/settings": return m.nav.settings.label;
      }
    };
    const hintOf = (to: (typeof NAV_ENTRIES)[number]): string => {
      switch (to) {
        case "/": return m.nav.home.hint;
        case "/learn": return m.nav.learn.hint;
        case "/plan": return m.nav.plan.hint;
        case "/quiz": return m.nav.quiz.hint;
        case "/spaces": return m.nav.spaces.hint;
        case "/career": return m.nav.career.hint;
        case "/settings": return m.nav.settings.hint;
      }
    };

    // ── 行动 ──────────────────────────────────────────────
    // 今日主行动 = 章级计划头项（V2，T8）；补考需先就地生成补考卷。
    const next = chapterPlan?.next;
    if (next) {
      const chapter = chapterIndex.get(next.unitId);
      const title = chapter
        ? chapterDisplayTitle(chapter, chapterPlan?.docTitleOf[chapter.id])
        : next.unitId;
      const actionLabel = m.units.action[next.kind];
      list.push({
        id: "act-next",
        label: `${m.cmd.startNext} · ${actionLabel} ${title}`,
        hint: m.cmd.startNextHint,
        section: "action",
        search: `${m.cmd.searchWords.start} ${actionLabel} ${title}`,
        run: () => {
          void (async () => {
            if (!chapterPlan) return;
            const ch = chapterIndex.get(next.unitId);
            const path = actionPath(next, ch);
            if (path) {
              navigate(path);
              return;
            }
            if (ch) {
              // retake-quiz：生成补考卷后进答题。
              const paper = makeRetakePaper(
                ch,
                chapterPlan.chaptersByDoc[ch.documentId] ?? [ch],
                chapterPlan.learner,
              );
              await storage.savePaper(paper);
              navigate(`/quiz/${paper.id}`);
            }
          })();
          void refresh();
        },
      });
    }
    // 有章但无待办时提供「出综合测」行动。
    if (chapterPlan && chapterPlan.total > 0 && !next) {
      list.push({
        id: "act-quiz",
        label: m.cmd.quizAll,
        hint: m.cmd.quizAllHint,
        section: "action",
        search: m.cmd.searchWords.quiz,
        run: () => navigate("/quiz/new"),
      });
    }
    list.push({
      id: "act-import",
      label: m.cmd.import,
      hint: m.cmd.importHint,
      section: "action",
      search: m.cmd.searchWords.import,
      run: () => navigate("/learn?import=1"),
    });

    // ── 跳转 ──────────────────────────────────────────────
    for (const to of NAV_ENTRIES) {
      const label = navOf(to);
      list.push({
        id: `nav-${to}`,
        label,
        hint: hintOf(to),
        section: "jump",
        search: `${label} ${hintOf(to)} ${m.cmd.searchWords.nav}`,
        run: () => navigate(to),
      });
    }

    // ── 最近（今日已完成，会话内存态）──────────────────────
    const recentList = [...recent]
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
      .map<Command>((r: DoneRecord) => ({
        id: `recent-${r.unitId}`,
        label: `${m.units.action[r.mode]} · ${unitTitle(r.unitId)}`,
        hint: agoText(m, r.at),
        section: "recent",
        search: `${unitTitle(r.unitId)} ${m.cmd.searchWords.recent}`,
        run: () =>
          navigate(
            r.mode === "assessment"
              ? `/assessment?unit=${r.unitId}`
              : `/study/session?unit=${r.unitId}`,
          ),
      }));
    list.push(...recentList);

    return list;
  }, [chapterPlan, chapterIndex, recent, refresh, navigate, m]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.search.toLowerCase().includes(q));
  }, [commands, query]);

  const sections = useMemo(() => {
    return SECTION_ORDER.map((key) => ({
      key,
      title: m.cmd.section[key],
      items: visible.filter((c) => c.section === key),
    })).filter((s) => s.items.length > 0);
  }, [visible, m]);

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
            placeholder={m.cmd.placeholder}
            className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            aria-label={m.cmd.searchAria}
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
              {m.cmd.emptyNoMatch(query)}
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.key}>
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
                        {cmd.section === "action" ? "▶ " : ""}
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

/** 相对时间（「2 分钟前」样式），文案走字典（zh/en 各自函数叶子）。 */
function agoText(m: Messages, at: number): string {
  const diff = Math.max(0, Date.now() - at);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return m.cmd.time.now;
  if (min < 60) return m.cmd.time.minAgo(min);
  const hour = Math.floor(min / 60);
  return m.cmd.time.hourAgo(hour);
}

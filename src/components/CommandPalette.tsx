import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLoopStore, storage } from "../stores/useLoopStore";
import { useSessionStore, type DoneRecord } from "../stores/useSessionStore";
import { unitTitle } from "../features/units";
import type { Chapter, LearningGoal } from "../domain";
import { useI18n, type Messages } from "../i18n";
import {
  actionPath,
  chapterDisplayTitle,
  makeRetakePaper,
} from "../features/plan/chapter-action";
import { CMD_OPEN_EVENT, openImportModal } from "./layout/AppShell";

/**
 * ⌘K 命令面板（UI Workbench U0；docs/ui-workbench-plan-2026-09.md §4.2/§6-U0）。
 *
 * 任意页面 ⌘K / Ctrl+K 或点击 Header 搜索框唤起：输入过滤 · ↑↓ 选择 ·
 * Enter 执行 · Esc 关闭。分区：行动（今日下一步）/ 搜索（文档·章节·目标内容
 * 索引）/ 命令（导入·出卷·页面跳转）/ 最近。
 */

type SectionKey = "action" | "search" | "commands" | "recent";

interface Command {
  id: string;
  label: string;
  hint?: string;
  section: SectionKey;
  run: () => void;
  search: string;
}

const SECTION_ORDER: SectionKey[] = ["action", "search", "commands", "recent"];

/** 跳转项与侧边栏可达项一一对应（不改路由；label/hint 取自当前语言字典）。 */
const NAV_ENTRIES = ["/", "/learn", "/plan", "/quiz", "/goals", "/learner", "/settings"] as const;

/** 内容搜索索引（每次打开 ⌘K 时刷新一次目标列表；文档/章取自章级快照）。 */
interface SearchIndex {
  goals: LearningGoal[];
  ready: boolean;
}

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
  const [index, setIndex] = useState<SearchIndex>({ goals: [], ready: false });

  /** 章 id → Chapter（章级行动跳转用）。 */
  const chapterIndex = useMemo(() => {
    const index = new Map<string, Chapter>();
    for (const list of Object.values(chapterPlan?.chaptersByDoc ?? {})) {
      for (const c of list) index.set(c.id, c);
    }
    return index;
  }, [chapterPlan]);

  // 全局快捷键：⌘K / Ctrl+K 开合；Header 搜索框经 CustomEvent 同开。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(CMD_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(CMD_OPEN_EVENT, onOpen);
    };
  }, []);

  // 打开时：聚焦输入框、清空关键词、刷新搜索索引与闭环快照。
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.select());
    if (!snapshot && !chapterPlan) void refresh();
    void (async () => {
      setIndex({ goals: await storage.listGoals(), ready: true });
    })();
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
        // U5：/learn 已升级为资料库观感，命令文案对齐 Library。
        case "/learn": return m.nav.library.label;
        case "/plan": return m.nav.plan.label;
        case "/quiz": return m.nav.quiz.label;
        case "/goals": return m.nav.goals.label;
        case "/learner": return m.nav.learner.label;
        case "/settings": return m.nav.settings.label;
      }
    };
    const hintOf = (to: (typeof NAV_ENTRIES)[number]): string => {
      switch (to) {
        case "/": return m.nav.home.hint;
        case "/learn": return m.nav.library.hint;
        case "/plan": return m.nav.plan.hint;
        case "/quiz": return m.nav.quiz.hint;
        case "/goals": return m.nav.goals.hint;
        case "/learner": return m.nav.learner.hint;
        case "/settings": return m.nav.settings.hint;
      }
    };

    // ── 行动：今日主行动 = 章级计划头项（补考需先就地生成补考卷）────────
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
          void refresh(m);
        },
      });
    }

    // ── 搜索：文档 / 章节 / 目标 内容索引 ─────────────────────────────
    const q = query.trim().toLowerCase();
    if (q) {
      const docs = chapterPlan?.docs ?? [];
      const pushDoc = (docTitle: string, run: () => void) => {
        list.push({
          id: `s-doc-${docTitle}`,
          label: `${m.cmd.typeDoc} · ${docTitle}`,
          section: "search",
          search: `${m.cmd.typeDoc} ${docTitle}`,
          run,
        });
      };
      for (const d of docs) {
        const title = d.title.toLowerCase();
        if (title.includes(q)) pushDoc(d.title, () => navigate("/learn"));
      }
      for (const list2 of Object.values(chapterPlan?.chaptersByDoc ?? {})) {
        for (const c of list2) {
          const docTitle = chapterPlan?.docTitleOf[c.id] ?? "";
          if (
            c.title.toLowerCase().includes(q) ||
            docTitle.toLowerCase().includes(q)
          ) {
            list.push({
              id: `s-ch-${c.id}`,
              label: `${m.cmd.typeChapter} · ${chapterDisplayTitle(c, docTitle)}`,
              hint: docTitle,
              section: "search",
              search: `${m.cmd.typeChapter} ${c.title} ${docTitle}`,
              run: () => navigate(`/learn/${c.id}`),
            });
          }
        }
      }
      for (const g of index.goals) {
        if (g.title.toLowerCase().includes(q) || g.type.toLowerCase().includes(q)) {
          list.push({
            id: `s-goal-${g.id}`,
            label: `${m.cmd.typeGoal} · ${g.title}`,
            hint: m.nav.goals.label,
            section: "search",
            search: `${m.cmd.typeGoal} ${g.title}`,
            // U6：目标搜索直达详情页。
            run: () => navigate(`/goals/${g.id}`),
          });
        }
      }
    }

    // ── 命令：导入 / 综合测（条件）/ 页面跳转 ─────────────────────────
    if (chapterPlan && chapterPlan.total > 0 && !next) {
      list.push({
        id: "cmd-quiz",
        label: m.cmd.quizAll,
        hint: m.cmd.quizAllHint,
        section: "commands",
        search: m.cmd.searchWords.quiz,
        run: () => navigate("/quiz/new"),
      });
    }
    // U5：⌘K 直接唤起全局导入 Modal（无需先跳 /learn?import=1）。
    list.push({
      id: "cmd-import",
      label: m.cmd.import,
      hint: m.cmd.importHint,
      section: "commands",
      search: m.cmd.searchWords.import,
      run: () => openImportModal(),
    });
    for (const to of NAV_ENTRIES) {
      const label = navOf(to);
      list.push({
        id: `cmd-nav-${to}`,
        label,
        hint: hintOf(to),
        section: "commands",
        search: `${label} ${hintOf(to)} ${m.cmd.searchWords.nav}`,
        run: () => navigate(to),
      });
    }

    // ── 最近（今日已完成，会话内存态）────────────────────────────────
    // U4（评审 D4）：概念级测评入口收敛——assessment 记录不再从 ⌘K 重开
    // （路由保留；N5 概念层回归后以「章内自检」复用）。
    const recentList = [...recent]
      .filter((r) => r.mode !== "assessment")
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
      .map<Command>((r: DoneRecord) => ({
        id: `recent-${r.unitId}`,
        label: `${m.units.action[r.mode]} · ${unitTitle(r.unitId)}`,
        hint: agoText(m, r.at),
        section: "recent",
        search: `${unitTitle(r.unitId)} ${m.cmd.searchWords.recent}`,
        run: () => navigate(`/study/session?unit=${r.unitId}`),
      }));
    list.push(...recentList);

    return list;
  }, [chapterPlan, chapterIndex, recent, refresh, navigate, m, query, index.goals]);

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
      className="fixed inset-0 z-50 bg-ink-1/25 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="mx-auto mt-[10vh] w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <kbd className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink-2">
            ⌘K
          </kbd>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={m.cmd.placeholder}
            className="flex-1 bg-transparent text-sm text-ink-1 outline-none placeholder:text-ink-3"
            aria-label={m.cmd.searchAria}
            autoFocus
            spellCheck={false}
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
            Esc
          </kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-2">
          {sections.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-3">
              {m.cmd.emptyNoMatch(query)}
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.key}>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
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
                        isActive ? "bg-primary/10 text-primary" : "text-ink-1"
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        {cmd.section === "action" ? "▶ " : ""}
                        {cmd.label}
                      </span>
                      {cmd.hint ? (
                        <span className="shrink-0 text-xs text-ink-3">{cmd.hint}</span>
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

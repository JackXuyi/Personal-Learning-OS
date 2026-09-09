/**
 * My Learner 聚合（UI Workbench U6 §7.6，纯函数 —— 页面直接消费）。
 *
 * 输入 = domain 原始字段（learner.byUnit / session records / 标题映射），
 * 输出 = 页面可直接渲染的强弱/误解/计数/行为模式。零引擎改动，零副作用。
 *
 * 所有数字都能指到对应 domain 字段（U6 验收抽查）：
 * - mastered / 计数   ← UnitMastery.mastery ≥ MASTERY_THRESHOLD（档位与 bandOf 同源）；
 * - accuracy          ← correctCount / attempts；
 * - misconceptions    ← UnitMastery.misconceptions 聚合；
 * - patterns          ← 由调用方传入的 session records 汇总（启发式标注）。
 */
import type { LearnerState, UnitMastery } from "../../domain";
import { MASTERY_FLOOR, MASTERY_THRESHOLD } from "../../domain";
import { bandOf } from "../../engine";
import type { DoneRecord } from "../../stores/useSessionStore";

/** 一个「我学过/有状态」的主体行（章或概念；title 由调用方解析好传入）。 */
export interface SubjectRow {
  id: string;
  /** 展示标题（章：docTitle · 章序章题；概念：概念名）。 */
  title: string;
  unit: UnitMastery;
}

export interface LearnerAggregate {
  /** 有学习记录的主体行（byUnit 中能解析出标题的；mastery 降序）。 */
  rows: SubjectRow[];
  /** 掌握计数（档位切分与 bandOf 同源：mastered ≥0.8 / proficient ≥0.4 / learning <0.4）。 */
  counts: {
    total: number;
    mastered: number;
    proficient: number;
    learning: number;
    notStarted: number;
  };
  /** 平均掌握度（0..1；无记录 = 0）。 */
  avgMastery: number;
  /** 客观正确率（ΣcorrectCount / Σattempts；无作答 = undefined）。 */
  accuracy: number | undefined;
  /** 全部误解去重聚合（unit.misconceptions）。 */
  misconceptions: string[];
  /** 需要复习的主体数（nextReviewAt 已到期，启发式提醒）。 */
  dueCount: number;
}

/**
 * 聚合 LearnerState：调用方传入「subjectId → 展示标题」的解析器（数据在页面层
 * 读取：章标题来自章节库，概念标题来自概念图谱），此处保持纯函数。
 */
export function aggregateLearner(
  learner: LearnerState,
  titleOf: (id: string) => string | undefined,
): LearnerAggregate {
  const rows: SubjectRow[] = [];
  for (const [id, unit] of Object.entries(learner.byUnit)) {
    const title = titleOf(id);
    // 只展示可解析主体的状态（未知残留 key 不渲染，避免脏数据入视图）。
    if (!title) continue;
    rows.push({ id, title, unit });
  }
  rows.sort((a, b) => b.unit.mastery - a.unit.mastery);

  let mastered = 0;
  let proficient = 0;
  let learning = 0;
  let notStarted = 0;
  let dueCount = 0;
  const now = Date.now();
  for (const r of rows) {
    const band = bandOf(r.unit.mastery);
    if (band === "mastered") mastered += 1;
    else if (band === "proficient") proficient += 1;
    else if (band === "learning") learning += 1;
    else notStarted += 1;
    if (r.unit.nextReviewAt !== undefined && r.unit.nextReviewAt <= now) dueCount += 1;
  }

  const sumMastery = rows.reduce((n, r) => n + r.unit.mastery, 0);
  const attempts = rows.reduce((n, r) => n + r.unit.attempts, 0);
  const correct = rows.reduce((n, r) => n + r.unit.correctCount, 0);
  const misconceptions = [
    ...new Set(rows.flatMap((r) => r.unit.misconceptions ?? [])),
  ];

  return {
    rows,
    counts: {
      total: rows.length,
      mastered,
      proficient,
      learning,
      notStarted,
    },
    avgMastery: rows.length === 0 ? 0 : sumMastery / rows.length,
    accuracy: attempts === 0 ? undefined : correct / attempts,
    misconceptions,
    dueCount,
  };
}

/** STRENGTHS：达标（≥ 0.8）主体，mastery 降序。 */
export function strengthsOf(a: LearnerAggregate, limit = 5): SubjectRow[] {
  return a.rows.filter((r) => r.unit.mastery >= MASTERY_THRESHOLD).slice(0, limit);
}

/** GAPS：低于及格线（< 0.6）的主体，mastery 升序（最弱在前）。 */
export function gapsOf(a: LearnerAggregate, limit = 5): SubjectRow[] {
  return a.rows
    .filter((r) => r.unit.mastery < MASTERY_FLOOR)
    .sort((x, y) => x.unit.mastery - y.unit.mastery)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* LEARNING PATTERNS（由 session records 汇总，标注启发式）             */
/* ------------------------------------------------------------------ */

export interface PatternStats {
  /** 会话内（今日）完成动作数。 */
  submissions: number;
  /** 测评对错比例（0..1；无测评记录 = undefined）。 */
  assessAccuracy: number | undefined;
  /** 平均掌握度变化（每次提交 Δ 的平均；无 = 0）。 */
  avgDelta: number;
  /** 复习 vs 测评的动作计数。 */
  byMode: { review: number; assessment: number };
}

/** 由会话级完成记录汇总行为模式（U6 验收：全部来自 records 字段）。 */
export function patternsFromRecords(records: DoneRecord[]): PatternStats {
  const byMode = { review: 0, assessment: 0 };
  let assessTotal = 0;
  let assessCorrect = 0;
  let deltaSum = 0;
  for (const r of records) {
    byMode[r.mode] += 1;
    deltaSum += r.masteryDelta;
    if (r.mode === "assessment" && typeof r.correct === "boolean") {
      assessTotal += 1;
      if (r.correct) assessCorrect += 1;
    }
  }
  return {
    submissions: records.length,
    assessAccuracy: assessTotal === 0 ? undefined : assessCorrect / assessTotal,
    avgDelta: records.length === 0 ? 0 : deltaSum / records.length,
    byMode,
  };
}

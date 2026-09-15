/**
 * F5 第 4 条 · 自测卡 —— 派生 / 稳定 id / 卡级调度 / 队列 / 孤儿清理 / 存储往返 单测。
 * （docs/learn-flashcard-design-2026-09.md §12：TC-UC01~08 / TC-EDGE-01~10 / TC-REG-01~04）
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:flashcard`）：
 *   npm run test:flashcard
 *
 * 零网络 / 零模型（本功能**零 AI**）：不 import `src/ai/*`；**不 import 任何 `.tsx`**
 * （strip-types 不支持 JSX）—— 卡片会话的 URL 模式判定因此抽在 `session-mode.ts`（纯 TS）。
 *
 * 两条硬断言（方案 §11.3）：
 *   ① 未评分路径对 storage **零写入**；② 评分后 `learnerState.byUnit[ch].mastery` **逐位不变**。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type {
  CardState,
  CardStateMap,
  Chapter,
  EvidenceEntry,
  LearnerState,
  SourceDocument,
} from "../src/domain/index.ts";
import {
  applyCardRating,
  cardIdOf,
  cardStats,
  deriveChapterCards,
  deriveDocumentCards,
  dueQueue,
  isCardDue,
  nextDueAt,
  pruneCardStates,
  uncardedPointCount,
} from "../src/engine/flashcard-engine.ts";
import { emptyUnit } from "../src/engine/learner-model.ts";
import { evidenceActionKey } from "../src/features/evidence-label.ts";
import {
  collectCards,
  peekCardStats,
  rateCard,
  resetCards,
  revertCard,
} from "../src/features/learn/flashcard-service.ts";
import { resolveReviewSessionMode } from "../src/features/study/session-mode.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import { LocalStorageAdapter } from "../src/storage/local.ts";

const results: string[] = [];
let failures = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ---------------- fixtures ---------------- */

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

const DOC: SourceDocument = {
  id: "d1",
  title: "测试资料",
  format: "txt",
  importedAt: 1,
  status: "ready",
  textPreview: "正文快照（卡片不读正文，仅保留字段完整性）。",
};

/**
 * 第 1 章：8 条要点 —— **3 张成卡**，5 条不成卡（3 条无 ref、1 条 quote 空、1 条脏区间）。
 * 成卡要点位于 index 0 / 1 / 4（验证 `index` 只用于展示、不参与 id）。
 */
const CH1: Chapter = {
  id: "c1",
  documentId: DOC.id,
  order: 1,
  title: "第 1 章",
  contentRef: { start: 0, end: 10 },
  keyPoints: ["kp1", "kp2", "kp3", "kp4", "kp5", "kp6", "kp7", "kp8"],
  keyPointRefs: [
    { point: "kp1", quote: "q1", start: 0, end: 10 },
    { point: "kp2", quote: "q2", start: 20, end: 30 },
    { point: "kp3", quote: "", start: 0, end: 0 }, // 定位失败（quote 空串）
    { point: "kp4", quote: "q4", start: 40, end: 35 }, // 脏区间（end <= start）
    { point: "kp5", quote: "q5", start: 50, end: 60 },
    // kp6 / kp7 / kp8 → 无 ref
  ],
  unitIds: [],
  status: "learning",
  createdAt: 1,
};

/** 第 2 章：1 张卡（验证跨章派生顺序）。 */
const CH2: Chapter = {
  id: "c2",
  documentId: DOC.id,
  order: 2,
  title: "第 2 章",
  contentRef: { start: 10, end: 20 },
  keyPoints: ["c2kp1"],
  keyPointRefs: [{ point: "c2kp1", quote: "c2q1", start: 100, end: 110 }],
  unitIds: [],
  status: "learning",
  createdAt: 2,
};

/** 老数据：有要点、无 keyPointRefs。 */
const CH_NO_REFS: Chapter = {
  id: "c-no-refs",
  documentId: DOC.id,
  order: 3,
  title: "第 3 章（无引用）",
  contentRef: { start: 20, end: 30 },
  keyPoints: ["a", "b", "c"],
  unitIds: [],
  status: "learning",
  createdAt: 3,
};

/** 边界章：空要点 / 空串 / 纯空白 / 重复文本 / ref.point 不匹配。 */
const CH_EDGE: Chapter = {
  id: "c-edge",
  documentId: DOC.id,
  order: 4,
  title: "第 4 章（边界）",
  contentRef: { start: 0, end: 5 },
  keyPoints: ["dup", "dup", "", "   ", "orphanRef"],
  keyPointRefs: [
    { point: "dup", quote: "dq", start: 1, end: 5 },
    { point: "另一个要点", quote: "other", start: 6, end: 9 }, // 与 keyPoints 不匹配
  ],
  unitIds: [],
  status: "learning",
  createdAt: 4,
};

async function seeded(chapters: Chapter[] = [CH1, CH2]): Promise<InMemoryStorage> {
  const store = new InMemoryStorage();
  await store.saveDocument(DOC);
  await store.saveChapters(DOC.id, chapters);
  return store;
}

/** 记数存储：断言「未评分路径零写入」。 */
class CountingStorage extends InMemoryStorage {
  saveCalls = 0;
  deleteCalls = 0;
  evidenceCalls = 0;
  override async saveCardState(state: CardState): Promise<void> {
    this.saveCalls += 1;
    await super.saveCardState(state);
  }
  override async deleteCardStates(cardIds: string[]): Promise<void> {
    this.deleteCalls += 1;
    await super.deleteCardStates(cardIds);
  }
  override async appendEvidence(entry: EvidenceEntry): Promise<void> {
    this.evidenceCalls += 1;
    await super.appendEvidence(entry);
  }
}

/** 证据写入必失败的存储（TC-UC02-04：证据失败不阻断）。 */
class EvidenceFailingStorage extends CountingStorage {
  override async appendEvidence(): Promise<void> {
    throw new Error("evidence down");
  }
}

const cardsOf = (store: InMemoryStorage, chapter: Chapter = CH1) =>
  deriveChapterCards(chapter, DOC.id);

/** 25 张卡（会话上限 20 用例）。 */
function manyCards(): Chapter {
  const keyPoints: string[] = [];
  const keyPointRefs = [] as NonNullable<Chapter["keyPointRefs"]>;
  for (let i = 0; i < 25; i++) {
    keyPoints.push(`m${i}`);
    keyPointRefs.push({ point: `m${i}`, quote: `mq${i}`, start: i * 10, end: i * 10 + 5 });
  }
  return { ...CH1, id: "c-many", keyPoints, keyPointRefs };
}

/* ---------------- 用例 ---------------- */

async function main() {
  /* ---------- TC-UC01 主路径：派生与只读计数 ---------- */

  await check("TC-UC01-01 派生：仅带原文出处的要点成卡（8 条 → 3 张）", () => {
    const cards = deriveChapterCards(CH1, DOC.id);
    assert.equal(cards.length, 3);
    assert.deepEqual(
      cards.map((c) => c.point),
      ["kp1", "kp2", "kp5"],
    );
    assert.deepEqual(
      cards.map((c) => c.index),
      [0, 1, 4],
      "index 仅用于展示/排序",
    );
    assert.equal(cards[0].quote, "q1");
    assert.equal(cards[0].documentId, DOC.id);
    assert.equal(cards[0].start, 0);
    assert.equal(cards[0].end, 10);
    assert.ok(cards.every((c) => c.id.startsWith("card_")));
  });

  await check("TC-UC01-02 peekCardStats 只读：零写入 + 真实计数", async () => {
    const store = new CountingStorage();
    await store.saveDocument(DOC);
    await store.saveChapters(DOC.id, [CH1, CH2]);
    const st = await peekCardStats({ documentId: DOC.id, chapterId: CH1.id }, T0, store);
    assert.deepEqual(
      { total: st.total, due: st.due, fresh: st.fresh, uncarded: st.uncarded },
      { total: 3, due: 0, fresh: 3, uncarded: 5 },
    );
    assert.equal(store.saveCalls, 0, "未评分路径不得写 CardState");
    assert.equal(store.deleteCalls, 0, "未评分路径不得删状态");
    assert.equal(store.evidenceCalls, 0, "只读路径不得写证据");
  });

  await check("TC-UC01-03 首次进入：队列全是新卡，且 8 条要点里 3 条未成卡", async () => {
    const store = await seeded();
    const col = await collectCards({ documentId: DOC.id, chapterId: CH1.id }, T0, store);
    assert.equal(col.queue.length, 3);
    assert.equal(col.fresh, 3);
    assert.equal(col.due, 0);
    assert.equal(col.uncarded, 5);
    assert.equal(col.pruned, 0, "无孤儿 → 零写入");
    assert.equal(uncardedPointCount([CH1, CH2]), 5);
  });

  /* ---------- TC-UC02 四档自评 ---------- */

  await check("TC-UC02-01 评分：nextReviewAt = now + 4d、reps=1、lapses=0", async () => {
    const store = await seeded();
    const card = cardsOf(store)[0];
    const res = await rateCard(card, "good", T0, store);
    assert.equal(res.nextReviewInDays, 4);
    assert.equal(res.nextReviewAt, T0 + 4 * DAY);
    const saved = (await store.listCardStates())[card.id];
    assert.ok(saved);
    assert.equal(saved.reps, 1);
    assert.equal(saved.lastRating, "good");
    assert.equal(saved.lapses, 0);
    assert.equal(saved.chapterId, CH1.id);
    assert.equal(saved.documentId, DOC.id);
  });

  await check("TC-UC02-02 评分后 learnerState.mastery 逐位不变（不动掌握度）", async () => {
    const store = await seeded();
    const before: LearnerState = { byUnit: { [CH1.id]: { ...emptyUnit(T0), mastery: 0.42, attempts: 3 } } };
    await store.saveLearnerState(before);
    const card = cardsOf(store)[0];
    await rateCard(card, "easy", T0, store);
    const after = await store.getLearnerState();
    assert.equal(after.byUnit[CH1.id].mastery, 0.42);
    assert.equal(after.byUnit[CH1.id].attempts, 3);
    assert.equal(after.byUnit[CH1.id].nextReviewAt, undefined, "卡片不得改写章级 nextReviewAt");
  });

  await check("TC-UC02-03 证据：kind=card / subjectId=chapterId / verdict / delta=0 / sourceId", async () => {
    const store = await seeded();
    const card = cardsOf(store)[0];
    await rateCard(card, "hard", T0, store);
    const log = await store.listEvidence();
    assert.equal(log.length, 1);
    assert.deepEqual(log[0], {
      at: T0,
      kind: "card",
      subjectId: CH1.id,
      verdict: "hard",
      delta: 0,
      sourceId: card.id,
    });
  });

  await check("TC-UC02-04 证据写入失败不阻断：CardState 仍落库", async () => {
    const store = new EvidenceFailingStorage();
    await store.saveDocument(DOC);
    await store.saveChapters(DOC.id, [CH1]);
    const card = deriveChapterCards(CH1, DOC.id)[0];
    const res = await rateCard(card, "forget", T0, store);
    assert.equal(res.nextReviewAt, T0 + DAY);
    const saved = (await store.listCardStates())[card.id];
    assert.equal(saved?.reps, 1);
    assert.equal(saved?.lapses, 1);
  });

  /* ---------- TC-UC03 卡级调度（互不影响 + 到期优先） ---------- */

  await check("TC-UC03-01/02 只评第 1 张：其余仍是新卡，章的 nextReviewAt 未被改写", async () => {
    const store = await seeded();
    const ls: LearnerState = { byUnit: { [CH1.id]: { ...emptyUnit(T0), mastery: 0.3, nextReviewAt: T0 + 99 * DAY } } };
    await store.saveLearnerState(ls);
    const [c1, c2] = deriveChapterCards(CH1, DOC.id);
    await rateCard(c1, "easy", T0, store);
    const state = await store.listCardStates();
    assert.equal(state[c1.id].nextReviewAt, T0 + 7 * DAY);
    assert.equal(state[c2.id], undefined);
    const after = await store.getLearnerState();
    assert.equal(after.byUnit[CH1.id].nextReviewAt, T0 + 99 * DAY, "章级调度不受卡片影响");
    // 第 2 天：c1 未到期，另两张仍是新卡 → 队列 = 新卡（保持章内序）
    const queue = dueQueue(deriveChapterCards(CH1, DOC.id), state, T0 + DAY);
    assert.deepEqual(
      queue.map((c) => c.id),
      [c2.id, deriveChapterCards(CH1, DOC.id)[2].id],
    );
  });

  await check("TC-UC03-03 到期优先于新卡（且到期卡按 nextReviewAt 升序）", async () => {
    const store = await seeded();
    const cards = deriveChapterCards(CH1, DOC.id);
    // 手动构造：c0 早已到期、c1 稍后到期、c2 未学
    const state: CardStateMap = {
      [cards[0].id]: st(cards[0], T0 - 10 * DAY, "good", 1),
      [cards[1].id]: st(cards[1], T0 - 1 * DAY, "hard", 1),
    };
    const queue = dueQueue(cards, state, T0);
    assert.deepEqual(
      queue.map((c) => c.id),
      [cards[0].id, cards[1].id, cards[2].id],
      "到期时间升序（c0 更早到期 → 更靠前），新卡补在后面",
    );
  });

  await check("TC-UC03-04 到期判定：新卡不算到期", () => {
    assert.equal(isCardDue(undefined, T0), false);
    assert.equal(isCardDue(st({ id: "x" } as never, T0 + 1, "good", 1), T0), false);
    assert.equal(isCardDue(st({ id: "x" } as never, T0, "good", 1), T0), true);
  });

  /* ---------- TC-UC04 无原文出处不成卡 ---------- */

  await check("TC-UC04-01/02 无 refs 的章：0 张卡 + 全部要点计入 uncarded + 零写入", async () => {
    const store = new CountingStorage();
    await store.saveDocument(DOC);
    await store.saveChapters(DOC.id, [CH_NO_REFS]);
    const st2 = await peekCardStats({ documentId: DOC.id, chapterId: CH_NO_REFS.id }, T0, store);
    assert.equal(st2.total, 0);
    assert.equal(st2.uncarded, 3);
    assert.equal(st2.nextDueAt, undefined);
    const col = await collectCards({ documentId: DOC.id, chapterId: CH_NO_REFS.id }, T0, store);
    assert.equal(col.cards.length, 0);
    assert.equal(col.queue.length, 0);
    assert.equal(col.scopeMissing, false, "章存在只是无出处 → 不是「章不存在」");
    assert.equal(store.saveCalls + store.deleteCalls + store.evidenceCalls, 0);
  });

  /* ---------- TC-UC05 跨章 / 会话上限 ---------- */

  await check("TC-UC05-01 资料级派生：章 order 升序 → 章内 index", () => {
    const cards = deriveDocumentCards([CH2, CH1], DOC.id); // 故意乱序传入
    assert.deepEqual(
      cards.map((c) => c.point),
      ["kp1", "kp2", "kp5", "c2kp1"],
    );
  });

  await check("TC-UC05-02 会话上限：25 张 → 队列截断到 20", async () => {
    const many = manyCards();
    const store = await seeded([many]);
    const col = await collectCards({ documentId: DOC.id, chapterId: many.id }, T0, store);
    assert.equal(col.total, 25);
    assert.equal(col.queue.length, 20);
    assert.equal(col.uncarded, 0);
  });

  await check("TC-UC05-03 章不存在：scopeMissing（不伪造卡片）", async () => {
    const store = await seeded();
    const col = await collectCards({ documentId: DOC.id, chapterId: "nope" }, T0, store);
    assert.equal(col.scopeMissing, true);
    assert.equal(col.total, 0);
    assert.equal(col.queue.length, 0);
  });

  await check("TC-UC05-04 全未到期时给出下次到期时间", async () => {
    const store = await seeded();
    const card = cardsOf(store)[0];
    await rateCard(card, "hard", T0, store);
    const col = await collectCards({ documentId: DOC.id, chapterId: CH1.id }, T0, store);
    // 其余两张仍是新卡 → 队列非空，但 nextDueAt 反映最近一次到期
    assert.equal(col.nextDueAt, T0 + 2 * DAY);
    assert.equal(nextDueAt(col.cards, col.state), T0 + 2 * DAY);
  });

  /* ---------- TC-UC06 要点改写 → 卡片退休 ---------- */

  await check("TC-UC06-01 要点文本变化 → 新卡 id（旧状态不被新卡读取）", async () => {
    const store = await seeded();
    const card = cardsOf(store)[0];
    await rateCard(card, "good", T0, store);
    const rewritten: Chapter = {
      ...CH1,
      keyPoints: ["kp1（改写版）", ...CH1.keyPoints.slice(1)],
      keyPointRefs: [{ point: "kp1（改写版）", quote: "q1", start: 0, end: 10 }, ...CH1.keyPointRefs!.slice(1)],
    };
    const newCard = deriveChapterCards(rewritten, DOC.id)[0];
    assert.notEqual(newCard.id, card.id);
    assert.equal(cardIdOf(rewritten.id, "kp1（改写版）"), newCard.id, "id 由内容派生");
    const state = await store.listCardStates();
    assert.equal(state[newCard.id], undefined, "新卡是全新卡片");
  });

  await check("TC-UC06-02 孤儿清理：只清本 scope，**不误删其他章**", async () => {
    const store = await seeded();
    const [c1] = deriveChapterCards(CH1, DOC.id);
    const [c2] = deriveChapterCards(CH2, DOC.id);
    await rateCard(c1, "good", T0, store);
    await rateCard(c2, "good", T0, store);
    // 改写第 1 章要点 → c1 状态成孤儿
    const rewritten: Chapter = {
      ...CH1,
      keyPoints: ["kp1-新", ...CH1.keyPoints.slice(1)],
      keyPointRefs: [{ point: "kp1-新", quote: "q1", start: 0, end: 10 }, ...CH1.keyPointRefs!.slice(1)],
    };
    const store2 = new InMemoryStorage();
    await store2.saveDocument(DOC);
    await store2.saveChapters(DOC.id, [rewritten, CH2]);
    await store2.saveCardState((await store.listCardStates())[c1.id]);
    await store2.saveCardState((await store.listCardStates())[c2.id]);

    const col = await collectCards({ documentId: DOC.id, chapterId: rewritten.id }, T0, store2);
    assert.equal(col.pruned, 1, "只清理第 1 章的孤儿");
    const left = await store2.listCardStates();
    assert.equal(left[c1.id], undefined);
    assert.ok(left[c2.id], "第 2 章的调度状态必须保留（scope 限定）");
  });

  /* ---------- TC-UC07 撤销 ---------- */

  await check("TC-UC07-01/02 撤销：有前状态则回写，首次评分则删除", async () => {
    const store = await seeded();
    const card = cardsOf(store)[0];
    await rateCard(card, "good", T0, store);
    const after = (await store.listCardStates())[card.id];
    assert.equal(after.reps, 1);
    // 撤销到"从未评分"
    await revertCard(card.id, undefined, store);
    assert.equal((await store.listCardStates())[card.id], undefined);
    // 撤销到上一次状态
    await store.saveCardState(after);
    const prev = st(card, T0 - 5 * DAY, "forget", 2);
    await revertCard(card.id, prev, store);
    assert.deepEqual((await store.listCardStates())[card.id], prev);
  });

  await check("TC-UC07-03 resetCards([]) 空数组 = 无操作", async () => {
    const store = new CountingStorage();
    await resetCards([], store);
    assert.equal(store.deleteCalls, 0);
  });

  /* ---------- TC-UC08 零 AI ---------- */

  await check("TC-UC08-01 零 AI：服务/引擎源码不 import src/ai", () => {
    const files = [
      "src/features/learn/flashcard-service.ts",
      "src/engine/flashcard-engine.ts",
      "src/features/study/session-mode.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/from\s+["'][^"']*\/ai\//.test(src), `${f} 不得 import src/ai/*`);
      assert.ok(!/provider\.chat|extractRestatementFeedback/.test(src), `${f} 不得触发模型调用`);
    }
  });

  /* ---------- TC-EDGE 边界 ---------- */

  await check("TC-EDGE-01 keyPoints 为空 → 无卡且不抛错", () => {
    assert.deepEqual(deriveChapterCards({ ...CH1, keyPoints: [], keyPointRefs: [] }, DOC.id), []);
    assert.equal(cardStats([], {}, T0).total, 0);
  });

  await check("TC-EDGE-02/03/05 空要点 / 脏区间 / ref 不匹配 一律不成卡", () => {
    const cards = deriveChapterCards(CH_EDGE, DOC.id);
    assert.equal(cards.length, 1, "只有 dup 成卡");
    assert.deepEqual(
      cards.map((c) => c.point),
      ["dup"],
    );
    // 未成卡 = 1（orphanRef：ref.point 与 keyPoints 不匹配）——
    // 空串 / 纯空白不计入分母（不是「要点」），dup 两条都成卡（同一张卡）
    assert.equal(uncardedPointCount([CH_EDGE]), 1);
  });

  await check("TC-EDGE-04 重复要点文本 → 同章内去重（同一张卡）", () => {
    const cards = deriveChapterCards(CH_EDGE, DOC.id);
    const dupCards = cards.filter((c) => c.point === "dup");
    assert.equal(dupCards.length, 1);
  });

  await check("TC-EDGE-06/07 pruneCardStates 无变化时返回原引用（零写入前提）", () => {
    const cards = deriveChapterCards(CH1, DOC.id);
    const empty: CardStateMap = {};
    assert.equal(pruneCardStates(cards, empty), empty);
    const alive: CardStateMap = { [cards[0].id]: st(cards[0], T0, "good", 1) };
    assert.equal(pruneCardStates(cards, alive), alive);
    const withOrphan: CardStateMap = { ...alive, card_orphan: st(cards[0], T0, "good", 1) };
    const pruned = pruneCardStates(cards, withOrphan);
    assert.notEqual(pruned, withOrphan);
    assert.deepEqual(Object.keys(pruned), [cards[0].id]);
  });

  await check("TC-EDGE-08 连续 forget 三次：lapses=3，每次 = 当时 now + 1d", () => {
    const card = deriveChapterCards(CH1, DOC.id)[0];
    let state: CardStateMap = {};
    state = applyCardRating(state, card, "forget", T0);
    assert.equal(state[card.id].nextReviewAt, T0 + DAY);
    state = applyCardRating(state, card, "forget", T0 + 2 * DAY);
    assert.equal(state[card.id].nextReviewAt, T0 + 3 * DAY);
    state = applyCardRating(state, card, "forget", T0 + 5 * DAY);
    assert.equal(state[card.id].nextReviewAt, T0 + 6 * DAY);
    assert.equal(state[card.id].lapses, 3);
    assert.equal(state[card.id].reps, 3);
  });

  await check("TC-EDGE-09 localStorage 往返：CardStateMap 完整还原", async () => {
    const mem = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, String(v)),
        removeItem: (k: string) => void mem.delete(k),
      },
      configurable: true,
      writable: true,
    });
    const a = new LocalStorageAdapter();
    const card = deriveChapterCards(CH1, DOC.id)[0];
    const state = applyCardRating({}, card, "hard", T0)[card.id];
    await a.saveCardState(state);
    const b = new LocalStorageAdapter(); // 新实例 → 从 localStorage 读回
    const restored = await b.listCardStates();
    assert.deepEqual(restored[card.id], state);
    assert.ok(mem.has("plos.flashcards"), "使用独立存储键（零迁移）");
  });

  await check("TC-EDGE-10 deleteCardStates([]) 短路：不触发持久化", async () => {
    let writes = 0;
    const mem = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          writes += 1;
          mem.set(k, String(v));
        },
        removeItem: (k: string) => void mem.delete(k),
      },
      configurable: true,
      writable: true,
    });
    const a = new LocalStorageAdapter();
    await a.deleteCardStates([]);
    assert.equal(writes, 0);
    const card = deriveChapterCards(CH1, DOC.id)[0];
    await a.saveCardState(applyCardRating({}, card, "good", T0)[card.id]);
    assert.ok(writes > 0, "非空写入仍会持久化");
  });

  /* ---------- TC-REG 回归 ---------- */

  await check("TC-REG-01 卡片评分不经 submitAnswer / applyRating（源码零引用）", () => {
    const src = readFileSync("src/features/learn/flashcard-service.ts", "utf8");
    assert.ok(!/\.submitAnswer\s*\(/.test(src), "不得调用 submitAnswer");
    assert.ok(!/\bapplyRating\s*\(/.test(src), "不得使用会移动 mastery 的 applyRating");
    assert.ok(!/saveLearnerState\s*\(/.test(src), "卡片不改写 LearnerState");
  });

  await check("TC-REG-02 既有入口（概念模式）判定不变", () => {
    const concept = resolveReviewSessionMode({ mode: null, documentId: null, chapterId: "c1" });
    assert.equal(concept.conceptMode, true);
    assert.equal(concept.cardMode, false);
    const byUnit = resolveReviewSessionMode({ mode: null, documentId: null, chapterId: null });
    assert.equal(byUnit.conceptMode, false);
    assert.equal(byUnit.cardMode, false);
  });

  await check("TC-REG-03 evidenceActionKey 四档穷尽：card 不再落到 review-points", () => {
    assert.equal(evidenceActionKey("card"), "card");
    assert.equal(evidenceActionKey("restatement"), "restatement");
    assert.equal(evidenceActionKey("review"), "review-points");
    assert.equal(evidenceActionKey("assessment"), "assessment");
  });

  await check("TC-REG-04 模式判定优先级：卡片模式优先于概念模式", () => {
    const cards = resolveReviewSessionMode({
      mode: "cards",
      documentId: "d1",
      chapterId: "c1",
    });
    assert.equal(cards.cardMode, true);
    assert.equal(cards.conceptMode, false, "chapterId 同时存在时不得误入概念模式");
    assert.equal(cards.cardDocumentId, "d1");
    assert.equal(cards.cardChapterId, "c1");

    const docLevel = resolveReviewSessionMode({
      mode: "cards",
      documentId: "d1",
      chapterId: null,
    });
    assert.equal(docLevel.cardMode, true);
    assert.equal(docLevel.cardChapterId, undefined);

    // 缺 documentId → 卡片模式不成立，退回既有语义
    const noDoc = resolveReviewSessionMode({
      mode: "cards",
      documentId: null,
      chapterId: "c1",
    });
    assert.equal(noDoc.cardMode, false);
    assert.equal(noDoc.conceptMode, true);
  });
}

/** 造一个 CardState（用例内构造调度状态用）。 */
function st(
  card: { id: string; chapterId?: string; documentId?: string },
  nextReviewAt: number,
  lastRating: CardState["lastRating"],
  reps: number,
): CardState {
  return {
    cardId: card.id,
    chapterId: card.chapterId ?? CH1.id,
    documentId: card.documentId ?? DOC.id,
    nextReviewAt,
    lastReviewedAt: nextReviewAt - DAY,
    reps,
    lastRating,
    lapses: lastRating === "forget" ? reps : 0,
  };
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

/**
 * 记忆信号采集（F9 通道 A 的输入）—— 从存储层并发读出**只读**信号集合。
 *
 * 为什么单独一个模块：`memory-facts.ts`（派生算法）要是纯函数、可 node 直测，
 * 就不能自己碰 IO；而派生要用到的源有 6 个，散在页面里读会让「哪些数据参与了推断」
 * 变得不可审计。此处一次性读齐，交给派生层。
 *
 * ⚠️ `now` 由调用方注入（`/memory` 页 mount 时取一次）—— 本模块**不取 `Date.now()`**，
 * 与 F2/F3 的「时间基准唯一」约束同口径：跨零点会让同一屏的两个数字互相矛盾。
 */
import type {
  Annotation,
  CardStateMap,
  EvidenceEntry,
  LearnerState,
  LearningGoal,
  Restatement,
} from "../../domain";
import type { StorageAdapter } from "../../storage/types";

/** 只读信号集合（派生层的全部输入）。 */
export interface MemorySignals {
  evidence: readonly EvidenceEntry[];
  cards: CardStateMap;
  learner: LearnerState;
  annotations: readonly Annotation[];
  restatements: readonly Restatement[];
  goals: readonly LearningGoal[];
  /**
   * 章数（划线密度的分母）。
   *
   * 由调用方传入而不是在本模块解析 `Chapter[]`：派生层只需一个数字，
   * 没必要让「读章」这件事渗进记忆模块（也避免与 F3 的统计口径耦合）。
   */
  chapterCount: number;
}

/** 并发读 6 个源（`now` 与 `chapterCount` 由调用方提供）。 */
export async function loadMemorySignals(
  store: StorageAdapter,
  chapterCount: number,
): Promise<MemorySignals> {
  const [evidence, cards, learner, annotations, restatements, goals] = await Promise.all([
    store.listEvidence(),
    store.listCardStates(),
    store.getLearnerState(),
    store.listAllAnnotations(),
    store.listAllRestatements(),
    store.listGoals(),
  ]);
  return { evidence, cards, learner, annotations, restatements, goals, chapterCount };
}

/** 章数统计（页面用它算好 `chapterCount` 再交给 `loadMemorySignals`）。 */
export async function countChapters(store: StorageAdapter): Promise<number> {
  const docs = await store.listDocuments();
  const perDoc = await Promise.all(docs.map((d) => store.listChapters(d.id)));
  return perDoc.reduce((sum, list) => sum + list.length, 0);
}

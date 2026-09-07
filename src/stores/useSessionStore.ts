import { create } from "zustand";
import type { SelfRating } from "../domain";

/** 复习/测评一次提交的完成记录（供「今日已完成」列表使用，会话级内存态）。 */
export interface DoneRecord {
  unitId: string;
  /** 动作类型：复习四档自评 或 测评对错。 */
  mode: "review" | "assessment";
  rating?: SelfRating;
  correct?: boolean;
  masteryDelta: number;
  nextReviewInDays: number;
  at: number;
}

interface SessionState {
  records: DoneRecord[];
  /** 提交完成时记录一条（同一单元覆盖旧记录）。 */
  record: (entry: DoneRecord) => void;
  /** 撤销时移除该单元记录。 */
  remove: (unitId: string) => void;
  /** 手动清空今日记录（队列页提供）。 */
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  records: [],
  record: (entry) =>
    set((s) => ({
      records: [...s.records.filter((r) => r.unitId !== entry.unitId), entry],
    })),
  remove: (unitId) =>
    set((s) => ({ records: s.records.filter((r) => r.unitId !== unitId) })),
  clear: () => set({ records: [] }),
}));

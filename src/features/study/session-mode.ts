/**
 * 复习会话的模式判定（`/study/session` 的 URL 参数 → 模式），**纯函数**。
 *
 * 为什么单独成文件（docs/learn-flashcard-design-2026-09.md §4.4）：
 *
 * `chapterId` 这个查询参数**已被概念模式占用** —— 原先的判定写在组件里：
 *   `const conceptMode = params.get("chapterId") !== null;`
 * 而自测卡（F5 第 4 条）的章级入口同样需要 `chapterId`。若不加优先级，
 * `/study/session?mode=cards&documentId=X&chapterId=Y` 会**误判为概念复习**。
 *
 * 因此把判定抽成纯函数并明确**优先级：卡片模式 > 概念模式 > 默认（全局闭环快照）**。
 * 抽成 `.ts` 而非留在 `.tsx` 里，是为了让 `node --experimental-strip-types` 的单测
 * 能覆盖它（strip-types 不支持 JSX，测试不得 import `.tsx`）。
 *
 * 既有三处入口（`ChapterGraphPage` / `GraphView` / `CommandPalette`）都不带
 * `mode=cards`，因此它们的判定结果与本次改动前**逐字节一致**（单测 TC-REG-04）。
 */

export interface SessionModeInput {
  /** `?mode=` 原值（未传 = null）。 */
  mode: string | null;
  /** `?documentId=` 原值（卡片模式的 scope 必需项）。 */
  documentId: string | null;
  /** `?chapterId=` 原值（概念模式必需项；卡片模式下是章级卡组 scope）。 */
  chapterId: string | null;
}

export interface SessionMode {
  /** 自测卡模式：`mode=cards` 且带 `documentId`。 */
  cardMode: boolean;
  /** 概念复习模式（章内概念队列）：**非卡片模式**且带 `chapterId`。 */
  conceptMode: boolean;
  /** 卡片模式的资料 scope（仅 `cardMode` 时有值）。 */
  cardDocumentId?: string;
  /** 卡片模式的章 scope（仅 `cardMode` 且带 `chapterId` 时有值）。 */
  cardChapterId?: string;
}

export function resolveReviewSessionMode(input: SessionModeInput): SessionMode {
  const documentId = input.documentId ?? "";
  // 卡片模式优先：缺 documentId 时不成立（退化为原概念 / 默认判定）
  const cardMode = input.mode === "cards" && documentId !== "";
  const conceptMode = !cardMode && input.chapterId !== null;
  const cardChapterId = (input.chapterId ?? "").trim();
  return {
    cardMode,
    conceptMode,
    cardDocumentId: cardMode ? documentId : undefined,
    cardChapterId: cardMode && cardChapterId !== "" ? cardChapterId : undefined,
  };
}

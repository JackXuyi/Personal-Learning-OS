/**
 * 资料删除级联（document-cascade）—— 纯编排，不 import 任何 store。
 *
 * 2026-09-13 自 library-actions.ts 抽出：导入管道的「覆盖式导入」（O2/D1）
 * 也要走同一条级联删除链路，而 import/pipeline.ts 必须保持 node 单测可直跑
 * （不得拖进 zustand store）。本模块只依赖 domain / storage 类型，store 由
 * 调用方显式传入；library-actions 保留带默认 store 的兼容包装。
 *
 * 顺序固定，避免半清理：
 *  0) Chunk：先清该资料的 chunk 与其向量（RAG 索引）——必须先查旧 chunk id，
 *     因为 chunk 行删掉之后就查不到「谁有向量」了
 *  1) 试卷：scope 命中该资料章节的全部试卷 → deletePaper（级联清草稿与结果）
 *  2) 概念：按章 unitIds 反查全局图，清单元与相关关系（无孤儿节点）→ saveGraph
 *  3) 派生学习资产：复述 / 自测卡状态 / 章级掌握度 / 小节 / 目标悬空章 id /
 *     社区包溯源 —— 判据与逐项理由见 `purgeDerivedAssets`
 *  4) 资料本体：deleteDocument（适配器内部再级联删章节与批注）
 *
 * ⚠️ **用户手写资产（复述 / 划线批注）的收集必须早于步骤 4** —— 批注由该步级联
 * 删除，删完再查就是 0。`userWrittenOf` 的调用点即按此排布，弹窗报数也走同一个
 * 收集器（否则「说要删的」与「实际删的」会漂移）。
 *
 * ⚠️ **为什么证据流（`plos.evidence`）不在这里清**（2026-09-22 拍板）
 *
 * 「删资料时补证据流清理」曾长期挂在遗留清单上（`raw-id-label-fix` §7 /
 * `evidence-log-idempotency-fix` §7.1 / `tech-debt-closeout` §4）。实测后**结论是不清**，
 * 因为它与上面七项**性质不同**：那些是「主体没了就永远指不到真源」的派生态，
 * 而证据流的三个消费方**全都不看主体、只看行为**——
 *
 * | 消费方 | 只用到 | 删行后的后果 |
 * |---|---|---|
 * | `/progress` 热力图 | `at` 逐日计数（`analytics.ts:38`） | 「我上周学了 5 次」回溯变 3 次 |
 * | F9 记忆节奏 / 学习模式 | `at` / `kind` 分布（`memory-facts.ts:81,163`） | 「你常在 22 点学习」结论被改写 |
 * | 首页最近证据 | 主体标题 | 唯一真实缺陷（幽灵行）→ 改为**消费侧跳过** |
 *
 * 即：证据流是**行为历史**，按主体删等于**回溯改写已发生的事实**。它的上限机制
 * （`EVIDENCE_LOG_MAX` 环形丢弃最旧）本来就在表达「按容量衰减，不按主体衰减」。
 * 因此本模块**不得**出现 `listEvidence` —— 守卫见 `tests/document-cascade.test.ts`
 * 的 TC-CASC-09。孤儿行由消费侧兜底（`HomePage::logToView` 直接跳过解析不到的章级行）。
 */
import type { Annotation, Restatement } from "../../domain";
import { hasNote } from "../../domain";
import type { StorageAdapter } from "../../storage";

/**
 * 删除连带清理的数量报告（确认弹窗展示用）。
 *
 * ⚠️ 分两组字段，**顺序即重要性**：弹窗要如实告诉用户「我会失去什么」，而
 * **用户手写的**（`annotations` / `restatements`）与**系统派生的**（前四项）
 * 在「删了还能不能拿回来」上性质不同 —— 前者不可再生，后者重学一遍就有。
 * 因此 `DeleteReport` 里用户资产必须是**独立、具名**的字段，不能并进计数总数，
 * 否则弹窗只能含混地说「将清理 N 项」。
 */
export interface DeleteReport {
  chapters: number;
  papers: number;
  concepts: number;
  /** 该资料已落库的 Chunk 数（RAG 索引；无索引时为 0）。 */
  chunks: number;
  /**
   * 该资料范围内的**全部**划线批注（含 `note` 为空的纯高亮）。删除告知必须覆盖
   * 实际删除范围，故这里是**总数**而不是「写了笔记的」——后者会低报（纯高亮同样被删）。
   */
  annotations: number;
  /**
   * 上面那批里**写了笔记**的条数（判据 `hasNote`，与 `/memory` 页的「N 条笔记」
   * 同一口径）。只作括号补注，不替代总数。
   */
  annotationsWithNote: number;
  /** 该资料范围内的复述次数（含用户手写原文）。 */
  restatements: number;
}

/**
 * 「这条记录归属被删资料」的**唯一判据** —— 复述与自测卡共用。
 *
 * ⚠️ 预检（`previewDeleteCascade`）与实际清理（`purgeDerivedAssets`）**必须**走
 * 同一个谓词。各写一份就是「两把尺子」：弹窗报 3 条、实际删掉 2 条，用户永远
 * 不会知道，而这类偏差只在**跨资料归属**（`chapterId` 命中但 `documentId` 不同，
 * 或反之）时才暴露 —— 恰恰是很难手工复现的那种。
 */
function belongsToDoc(
  record: { readonly documentId: string; readonly chapterId: string },
  docId: string,
  chapterIds: ReadonlySet<string>,
): boolean {
  return record.documentId === docId || chapterIds.has(record.chapterId);
}

/** 该资料范围内的**用户手写**资产（弹窗必须如实告知的两类）。 */
interface UserWrittenAssets {
  annotations: Annotation[];
  restatements: Restatement[];
}

/**
 * 收集该资料范围内**用户手写**的资产 —— 删除告知与实际清理的**共用入口**。
 *
 * 为什么要抽出来：这两类东西是「删了拿不回来」的（弹窗据它报数、清理据它删除），
 * 若各写一份过滤式，就会出现「弹窗说 3 条、实际删 2 条」这种**用户永远不会
 * 发现**的偏差 —— 它只在跨资料归属（`chapterId` 命中而 `documentId` 不同，或反之）
 * 时才暴露，恰恰是最难手工复现的一类。
 *
 * ⚠️ 调用方必须在 `store.deleteDocument` **之前**取（批注由该步级联删除）。
 */
async function userWrittenOf(
  docId: string,
  chapterIds: ReadonlySet<string>,
  store: StorageAdapter,
): Promise<UserWrittenAssets> {
  const restatements = (await store.listAllRestatements()).filter((r) =>
    belongsToDoc(r, docId, chapterIds),
  );
  // 批注按 `documentId` 归属 —— 与 `forgetDocument` 的级联判据同维度
  // （`listAnnotations(docId)` 内部即 `a.documentId === documentId`）。
  const annotations = await store.listAnnotations(docId);
  return { annotations, restatements };
}

/**
 * 用户手写资产 → 报告三项。**唯一算式**：`previewDeleteCascade` 与
 * `deleteDocumentCascade` 都从这里取，不允许任一侧再写一遍 `.length`。
 *
 * ⚠️ `annotations` 是**总数**（含纯高亮），`annotationsWithNote` 才是「写了笔记的」
 * （判据 `hasNote`）。两个数不是一回事，别互相替换。
 */
function writtenCountsOf(written: UserWrittenAssets): Pick<
  DeleteReport,
  "annotations" | "annotationsWithNote" | "restatements"
> {
  return {
    annotations: written.annotations.length,
    annotationsWithNote: written.annotations.filter(hasNote).length,
    restatements: written.restatements.length,
  };
}

/**
 * 删除前预检：只读统计，返回将被连带清理的数量（供确认弹窗展示）。
 *
 * ⚠️ 口径上必须与 `deleteDocumentCascade` **逐项对齐**（尤其用户手写的复述与
 * 划线批注 —— 弹窗漏报它们等于让用户在不知情下丢掉自己写的东西）。守卫见
 * `tests/document-cascade.test.ts` 的 TC-CASC-14。
 */
export async function previewDeleteCascade(
  docId: string,
  store: StorageAdapter,
): Promise<DeleteReport> {
  const chapters = await store.listChapters(docId);
  const chapterIds = new Set(chapters.map((c) => c.id));

  // PLOS 出卷恒为「单资料范围」：任一命中该资料章节即视为该资料的试卷。
  const papers = (await store.listPapers()).filter((p) =>
    p.scope.chapterIds.some((id) => chapterIds.has(id)),
  );

  const unitIds = new Set(chapters.flatMap((c) => c.unitIds));
  let concepts = 0;
  if (unitIds.size > 0) {
    const g = await store.getGraph();
    concepts = g.units.filter((u) => unitIds.has(u.id)).length;
  }
  const chunks = (await store.listChunksByDocument(docId)).length;

  // 用户手写资产（与实际清理同源：`userWrittenOf` + `writtenCountsOf`）
  const written = await userWrittenOf(docId, chapterIds, store);

  return {
    chapters: chapters.length,
    papers: papers.length,
    concepts,
    chunks,
    ...writtenCountsOf(written),
  };
}

/**
 * 回收该资料的**派生学习资产**（步骤 3）。
 *
 * 判据统一为一句：**主体（章）随资料消失 ⇒ 这条数据永久指不到真源**。
 * 逐项及其单独理由：
 *
 * - **复述**：由章派生（`Restatement.chapterId`）。此处**包含用户手写原文**，
 *   与「批注随资料删」是**同一条口径**（`learn-highlight-note-design:337`
 *   的既定决策：「否则留下指不到正文的孤儿」）。两条规矩只差一处会自相矛盾。
 * - **自测卡状态**：卡面由 `Chapter` 每次派生（`DerivedCard`），章没了卡也不存在，
 *   留着的调度状态没有任何可渲染对象。
 * - **章级掌握度**（`learner.byUnit`）：其**真源是卷面**，而卷面已在步骤 1 删除 ⇒
 *   留着就是第二把尺子（如 `/learner` 平均掌握度的分母）。消费方虽然已过滤
 *   解析不到的主体（`analytics.ts:354`、`aggregate.ts:56`），过滤是兜底，不是清理。
 * - **小节**：与 chunk 同级的冗余分段，步骤 0 清了 chunk 却漏了它（F4 文档
 *   `data-portability-export-import-design:273` 记的「不清 Section/Chunk」
 *   对 chunk 已过时、对 Section 曾成立）。
 * - **目标范围 / 社区包溯源**：引用资料或章 id 的**指针**，随被引用方失效而失效。
 *
 * ⚠️ **证据流刻意不在本函数内**，理由见文件头大段注释。
 *
 * ⚠️ 本函数与 `previewDeleteCascade` 是**同一件事的两个视角**（实际做 / 只说数量）：
 * 归属判据一律走 `belongsToDoc`、笔记判据一律走 `hasNote`，**不得在任一侧内联重写**。
 * 复述实体由调用方经 `userWrittenOf` 收集后传入 —— 与弹窗报数用的是同一份数组，
 * 而不是「同样的过滤条件再算一遍」。
 *
 * 批注不在此处删除（由适配器的 `forgetDocument` 级联）—— 但仍**报数**（见 report）。
 */
async function purgeDerivedAssets(
  docId: string,
  chapterIds: ReadonlySet<string>,
  written: UserWrittenAssets,
  store: StorageAdapter,
): Promise<void> {
  // 3a) 复述记录（含用户手写原文；实体来自与预检同源的 userWrittenOf）
  for (const r of written.restatements) await store.deleteRestatement(r.id);

  // 3b) 自测卡调度状态（`deleteCardStates([])` 是既定的空操作，无需前置判空）
  const cardStates = await store.listCardStates();
  const orphanCardIds = Object.values(cardStates)
    .filter((c) => belongsToDoc(c, docId, chapterIds))
    .map((c) => c.cardId);
  await store.deleteCardStates(orphanCardIds);

  // 3c) 章级掌握度键。**只在真的删掉了键时才回写** —— 否则每次删资料都会
  // 全量重写 learnerState（localStorage 后端是一次完整 persist）。
  const learner = await store.getLearnerState();
  const byUnit = { ...learner.byUnit };
  let learnerTouched = false;
  for (const id of chapterIds) {
    if (id in byUnit) {
      delete byUnit[id];
      learnerTouched = true;
    }
  }
  if (learnerTouched) await store.saveLearnerState({ ...learner, byUnit });

  // 3d) 小节（逐章查、逐条删 —— 适配器没有按资料批量接口，量级是「章数 × 小节数」）
  for (const chapterId of chapterIds) {
    const sections = await store.listSections(chapterId);
    for (const s of sections) await store.deleteSection(s.id);
  }

  // 3e) 目标范围里的悬空章 id
  for (const goal of await store.listGoals()) {
    const required = goal.requiredChapterIds;
    if (!required || required.length === 0) continue;
    const kept = required.filter((id) => !chapterIds.has(id));
    // ⚠️ 一条**必须保留的例外**：`kept` 为空时**不动**。
    // `scopeOf` 把「空 requiredChapterIds」读作「**全库回退**」（goal-util.ts:46），
    // 于是「把悬空 id 剔干净」会把一个限定目标**静默变成全局目标** ——
    // 那比留着悬空 id（该目标退化为 0 章，诚实）错得更远。
    // 同理 `kept.length === required.length` 时无变化，跳过写入。
    if (kept.length === 0 || kept.length === required.length) continue;
    await store.saveGoal({ ...goal, requiredChapterIds: kept });
  }

  // 3f) 社区包溯源行（逐字段重写；包记录本身保留 —— 它的另一半职责是
  // 「这个包导入过了」的去重提示，不随某份资料删除而失效）
  for (const pack of await store.listImportedPacks()) {
    if (!pack.documentIds.includes(docId)) continue;
    await store.saveImportedPack({
      ...pack,
      documentIds: pack.documentIds.filter((id) => id !== docId),
    });
  }
}

/**
 * 删除资料并级联清理（顺序见模块头）。store 必传——保持 node 单测可直跑。
 *
 * 返回的 `DeleteReport` 与 `previewDeleteCascade` **同源**：用户手写资产用同一个
 * `userWrittenOf` 收集、同一个 `writtenCountsOf` 报数 —— 所以「弹窗说要删的」
 * 就是「实际删掉的」，不存在两套口径。
 */
export async function deleteDocumentCascade(
  docId: string,
  store: StorageAdapter,
): Promise<DeleteReport> {
  const chapters = await store.listChapters(docId);
  const chapterIds = new Set(chapters.map((c) => c.id));

  // 用户手写资产先收集（步骤 4 的 `deleteDocument` 会级联删批注 → 之后再查就没了）。
  const written = await userWrittenOf(docId, chapterIds, store);

  // 0) Chunk + 向量（RAG 索引）
  const chunks = await store.listChunksByDocument(docId);
  for (const c of chunks) await store.deleteEmbeddingsByTarget(c.id);
  await store.deleteChunksByDocument(docId);

  // 1) 试卷（含草稿与结果）
  const papers = (await store.listPapers()).filter((p) =>
    p.scope.chapterIds.some((id) => chapterIds.has(id)),
  );
  for (const p of papers) await store.deletePaper(p.id);

  // 2) 概念：只保留不在该资料单元集内的单元；关系两端都保留才保留
  const unitIds = new Set(chapters.flatMap((c) => c.unitIds));
  let concepts = 0;
  if (unitIds.size > 0) {
    const g = await store.getGraph();
    const keepUnits = g.units.filter((u) => !unitIds.has(u.id));
    concepts = g.units.length - keepUnits.length;
    const keep = new Set(keepUnits.map((u) => u.id));
    await store.saveGraph({
      units: keepUnits,
      relations: g.relations.filter((r) => keep.has(r.fromId) && keep.has(r.toId)),
    });
  }

  // 3) 派生学习资产（复述 / 卡片 / 掌握度 / 小节 / 目标范围 / 包溯源）
  await purgeDerivedAssets(docId, chapterIds, written, store);

  // 4) 资料本体（适配器内部再级联删章节与批注）
  await store.deleteDocument(docId);
  return {
    chapters: chapters.length,
    papers: papers.length,
    concepts,
    chunks: chunks.length,
    ...writtenCountsOf(written),
  };
}

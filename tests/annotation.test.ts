/**
 * F5 第 2 条 · 划线高亮与笔记 —— 纯逻辑单测
 * （docs/learn-highlight-note-design-2026-09.md §12 TC-UC01~06 / TC-EDGE / TC-REG-01）。
 *
 * 运行：npm run test:annotation
 *
 * 三条边界：
 *  1. **不 import 任何 `.tsx`**（`--experimental-strip-types` 不支持 JSX）；
 *  2. **不碰真实 DOM** —— DOM 定位的正确性全部落在纯函数 `locateQuoteInDomText`
 *     与 `plainTextLayout` 上（DOM 包裹部分靠代码自审，本仓库禁止无头浏览器校验）；
 *  3. **零真实 AI / 零网络**：本特性根本不 import `src/ai/*`（TC-UC06-01 由源码断言锁定）。
 *
 * ⚠️ 关键回归：本文件同时锁死 **T12（`?at=` 偏前修复）** 的口径 ——
 * 「DOM 文本 ≠ 源串」这个事实由 `plainTextToDomText` 的断言固化，
 * 后续若有人把它改回「按源串偏移直接喂 TreeWalker」，这里会先红。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ANNOTATION_LIMITS,
  annotationId,
  hasNote,
  quoteExcerpt,
} from "../src/domain/index.ts";
import type { Annotation, Chapter, SourceDocument } from "../src/domain/index.ts";
import { foldToNone, foldWhitespace, locateQuoteInDomText, bestOccurrence } from "../src/features/learn/evidence-anchor.ts";
import {
  plainTextLayout,
  plainTextToDomText,
} from "../src/features/learn/render/plain-text-layout.ts";
import { applyChapterEdit } from "../src/features/learn/chapter-edit-service.ts";
import { splitDocumentNow } from "../src/features/learn/split-service.ts";
import { sourceRangeCandidates } from "../src/features/learn/highlight.ts";
import {
  createAnnotation,
  listChapterAnnotations,
  relinkAnnotations,
  removeAnnotation,
  updateAnnotationNote,
} from "../src/features/learn/annotation-service.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import { zh } from "../src/i18n/messages/zh.ts";

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

// ===== 构造辅助 =====

/** 章在文档中的起始偏移（非 0，用来验证「章内相对 → 文档绝对」的换算）。 */
const BASE = 100;
/** 章正文：含标题行、空行、行尾空白、跨行正文 —— 覆盖 plainTextLayout 的全部三类行。 */
const BODY = "# 6.1.3 注册程序  \n\n企业注册须经投资协调局审批。\n相关材料包括章程。";

function makeDoc(): SourceDocument {
  return {
    id: "doc-1",
    title: "东帝汶投资指南",
    format: "pdf",
    textPreview: "前".repeat(BASE) + BODY + "后记",
    importedAt: 0,
  } as SourceDocument;
}

function makeChapter(): Chapter {
  return {
    id: "ch-1",
    documentId: "doc-1",
    title: "6.1.3 注册程序",
    order: 1,
    status: "learning",
    keyPoints: [],
    keyPointRefs: [],
    contentRef: { start: BASE, end: BASE + BODY.length },
  } as unknown as Chapter;
}

const DOC = makeDoc();
const CH = makeChapter();

/** 每个用例一份干净存储（用例之间零串味）。 */
function newStore() {
  return new InMemoryStorage();
}

/* ---------------- 1) domain 纯函数 ---------------- */

await check("TC-ANN-01 annotationId：同参同 id、区间敏感、前缀固定", () => {
  const a = annotationId("doc-1", 10, 20);
  assert.equal(a, annotationId("doc-1", 10, 20), "同参必须同 id（幂等的基础）");
  assert.notEqual(a, annotationId("doc-1", 10, 21), "end 变 → id 变");
  assert.notEqual(a, annotationId("doc-1", 11, 20), "start 变 → id 变");
  assert.notEqual(a, annotationId("doc-2", 10, 20), "doc 变 → id 变");
  assert.ok(a.startsWith("ann_"), "id 前缀固定为 ann_");
  // 区间拼接不能因字符串相连而撞车（NUL 分隔的意义）
  assert.notEqual(annotationId("d", 1, 23), annotationId("d", 12, 3));
});

await check("TC-ANN-02 hasNote：空串 / 全空白 = 无笔记；有内容 = 有笔记", () => {
  const base: Annotation = {
    id: "ann_x",
    documentId: "d",
    chapterId: "c",
    quote: "q",
    start: 0,
    end: 1,
    note: "",
    createdAt: 0,
    updatedAt: 0,
  };
  assert.equal(hasNote(base), false);
  assert.equal(hasNote({ ...base, note: "   \n " }), false, "全空白视为无笔记");
  assert.equal(hasNote({ ...base, note: "与 WH 模块相关" }), true);
});

await check("TC-ANN-03 quoteExcerpt：折叠空白 + 截断加省略号", () => {
  assert.equal(quoteExcerpt("a\n\n b"), "a b");
  assert.equal(quoteExcerpt("  两端空白  "), "两端空白");
  const long = "字".repeat(100);
  const cut = quoteExcerpt(long, 10);
  assert.equal(cut, `${"字".repeat(10)}…`);
  assert.equal(quoteExcerpt(long, 100), long, "恰好等于上限时不加省略号");
});

/* ---------------- 2) 折叠档（D7）---------------- */

await check("TC-FOLD-01 foldToNone：移除全部空白并给出正确映射（含哨兵）", () => {
  const { folded, map } = foldToNone("a\n b\u3000c ");
  assert.equal(folded, "abc");
  assert.deepEqual(map, [0, 3, 5, 7], "map 逐位指向原始下标，末尾为 s.length 哨兵");
});

await check("TC-FOLD-02 foldToNone ≠ foldWhitespace：跨行场景只有「移除式」能对齐", () => {
  const source = "第一行\n第二行";
  // 逐行渲染后的 DOM 文本（\n 不进任何文本节点）
  const domText = plainTextToDomText(source);
  assert.equal(domText, "第一行第二行");
  // 压成空格 → 必然 miss（回归锁定 D7）
  assert.equal(foldWhitespace(domText).folded.indexOf(foldWhitespace(source).folded), -1);
  // 移除式 → 命中
  assert.ok(foldToNone(domText).folded.includes(foldToNone(source).folded));
});

/* ---------------- 3) 渲染口径（DOM 文本的唯一真源）---------------- */

await check("TC-DOMTEXT-01 plainTextLayout：标题剥前后缀 / 空行零文本 / 行尾空白丢弃", () => {
  const lines = plainTextLayout(BODY);
  assert.deepEqual(
    lines.map((l) => [l.kind, l.text]),
    [
      ["heading", "6.1.3 注册程序"],
      ["blank", ""],
      ["text", "企业注册须经投资协调局审批。"],
      ["text", "相关材料包括章程。"],
    ],
  );
  // srcStart 逐个对得上（含被 split 吞掉的 \n 与被 trimEnd 掉的 2 个行尾空格）：
  //   行0 = "# 6.1.3 注册程序  " 长 14 → 行1 起点 15
  //   行1 = ""（空行）长 0        → 行2 起点 16
  //   行2 = 14 字                 → 行3 起点 31
  assert.deepEqual(
    lines.map((l) => l.srcStart),
    [0, 15, 16, 31],
  );
});

await check("TC-DOMTEXT-02 plainTextLayout：闭合式标题的尾部 ### 也被剥掉", () => {
  const [line] = plainTextLayout("## 小标题 ##");
  assert.equal(line.text, "小标题");
  assert.equal(line.level, 2);
});

await check("TC-DOMTEXT-03 plainTextToDomText 必然短于源串（T12 的核心事实）", () => {
  const domText = plainTextToDomText(BODY);
  assert.ok(domText.length < BODY.length, "DOM 文本必须更短（\n 与行尾空白都不进文本节点）");
  // 差额 = 换行数 + 被剥掉的前缀/行尾空白
  assert.equal(domText.startsWith("6.1.3 注册程序"), true, "标题前缀已剥");
  assert.equal(domText.includes("\n"), false, "DOM 文本里没有换行符");
  // ⚠️ 任何「把源串偏移直接当 DOM 偏移」的实现都会因为这段差额而系统偏前，
  //    这正是 T12 要消灭的口径（见 highlight.ts 的 highlightSourceRange）。
});

/* ---------------- 4) DOM 文本上的定位（两档 + 顺序贪心）---------------- */

await check("TC-LOC-01 精确档：命中并返回 DOM 文本区间", () => {
  const hit = locateQuoteInDomText("甲乙丙丁戊", "乙丙");
  assert.deepEqual(hit, { start: 1, end: 3 });
});

await check("TC-LOC-02 折叠档：跨行选区（quote 含 \\n）在 DOM 文本上命中", () => {
  const domText = plainTextToDomText("第一行\n第二行");
  const hit = locateQuoteInDomText(domText, "第一行\n第二行");
  assert.deepEqual(hit, { start: 0, end: domText.length });
});

await check("TC-LOC-03 顺序贪心（D8）：同一 quote 两次命中的是两处，不重复", () => {
  const domText = "甲乙甲乙";
  const first = locateQuoteInDomText(domText, "甲乙", 0);
  assert.deepEqual(first, { start: 0, end: 2 });
  const second = locateQuoteInDomText(domText, "甲乙", first!.end);
  assert.deepEqual(second, { start: 2, end: 4 }, "从上次结束处继续找 → 不重复高亮同一处");
  assert.equal(locateQuoteInDomText(domText, "甲乙", second!.end), undefined, "再往后没有了");
});

await check("TC-LOC-04 未命中 / 空 quote / from 越界 → undefined（诚实降级，不抛错）", () => {
  assert.equal(locateQuoteInDomText("甲乙丙", "丁"), undefined);
  assert.equal(locateQuoteInDomText("甲乙丙", "   "), undefined);
  assert.equal(locateQuoteInDomText("", "甲"), undefined);
  // from 越界 → 夹取到末尾，仍不应抛错
  assert.equal(locateQuoteInDomText("甲乙丙", "甲", 999), undefined);
});

/* ---------------- 5) 服务层八态 ---------------- */

await check("TC-UC01-01 ok：锚定成功 → 落库文档绝对区间，slice === quote", async () => {
  const store = newStore();
  const quote = "企业注册须经投资协调局审批。";
  const r = await createAnnotation({ doc: DOC, chapter: CH, quote, now: 1, storage: store });
  assert.equal(r.status, "ok");
  const rec = r.record!;
  assert.equal(rec.quote, quote);
  assert.equal(DOC.textPreview.slice(rec.start, rec.end), quote, "区间必须逐字等于 quote");
  assert.equal(rec.start, BASE + BODY.indexOf(quote), "绝对偏移 = 章基准 + 章内偏移");
  assert.equal(rec.chapterId, "ch-1");
  assert.equal(rec.note, "", "缺省笔记为空串（纯高亮）");
  assert.equal(rec.createdAt, 1);
  assert.equal(rec.updatedAt, 1);
  assert.deepEqual(await listChapterAnnotations("ch-1", store), [rec]);
});

await check("TC-UC01-02 duplicate：同区间再划一次 → 不新建、不覆盖已有笔记", async () => {
  const store = newStore();
  const quote = "相关材料包括章程。";
  const first = await createAnnotation({ doc: DOC, chapter: CH, quote, note: "第一次的笔记", now: 1, storage: store });
  assert.equal(first.status, "ok");
  const again = await createAnnotation({ doc: DOC, chapter: CH, quote, note: "第二次的笔记", now: 2, storage: store });
  assert.equal(again.status, "duplicate");
  assert.equal(again.record!.id, first.record!.id);
  assert.equal(again.record!.note, "第一次的笔记", "duplicate 绝不覆盖已有笔记");
  assert.equal((await listChapterAnnotations("ch-1", store)).length, 1);
});

await check("TC-UC01-03/04 too-short 与 no-body：都零写入", async () => {
  const store = newStore();
  const short = await createAnnotation({ doc: DOC, chapter: CH, quote: "企", now: 1, storage: store });
  assert.equal(short.status, "too-short");
  const noBody = await createAnnotation({
    doc: { id: "doc-empty", textPreview: "" },
    chapter: CH,
    quote: "任意内容",
    now: 1,
    storage: store,
  });
  assert.equal(noBody.status, "no-body");
  assert.deepEqual(await listChapterAnnotations("ch-1", store), [], "两种失败都不得留下记录");
});

await check("TC-UC01-05 折叠命中的回校：落库 quote = **原文实际切片**（不是选区字面）", async () => {
  const store = newStore();
  // 选区里把原文的换行写成了空格（AI/用户复制粘贴的常见形态）
  const r = await createAnnotation({
    doc: DOC,
    chapter: CH,
    quote: "企业注册须经投资协调局审批。 相关材料包括章程。",
    now: 1,
    storage: store,
  });
  assert.equal(r.status, "ok");
  const rec = r.record!;
  assert.equal(rec.quote, "企业注册须经投资协调局审批。\n相关材料包括章程。", "必须是原文字面");
  assert.equal(DOC.textPreview.slice(rec.start, rec.end), rec.quote, "不变式：slice 逐字相等");
});

await check("TC-UC02-01/02/03 笔记：正常落库 / 超长拒绝 / 全空白原样保留但视为无笔记", async () => {
  const store = newStore();
  const ok = await createAnnotation({
    doc: DOC,
    chapter: CH,
    quote: "企业注册须经投资协调局审批。",
    note: "与 WH 模块供应商准入相关",
    now: 5,
    storage: store,
  });
  assert.equal(ok.status, "ok");
  assert.equal(hasNote(ok.record!), true);
  assert.equal(ok.record!.updatedAt, ok.record!.createdAt, "新建时两者相等");

  const tooLong = await createAnnotation({
    doc: DOC,
    chapter: CH,
    quote: "相关材料包括章程。",
    note: "甲".repeat(ANNOTATION_LIMITS.maxNoteChars + 1),
    now: 5,
    storage: store,
  });
  assert.equal(tooLong.status, "too-long");

  const blank = await createAnnotation({
    doc: DOC,
    chapter: CH,
    quote: "相关材料包括章程。",
    note: "   ",
    now: 5,
    storage: store,
  });
  assert.equal(blank.status, "ok");
  assert.equal(blank.record!.note, "   ", "原样保留（不 trim，避免替用户改内容）");
  assert.equal(hasNote(blank.record!), false, "但 UI 显示「无笔记」");
});

await check("TC-UC01-06 capped：达章上限 → 如实拒绝，不丢旧数据", async () => {
  const store = newStore();
  for (let i = 0; i < ANNOTATION_LIMITS.maxPerChapter; i++) {
    await store.saveAnnotation({
      id: `ann_fill_${i}`,
      documentId: "doc-1",
      chapterId: "ch-1",
      quote: "填充",
      start: i * 10,
      end: i * 10 + 2,
      note: "",
      createdAt: 0,
      updatedAt: 0,
    });
  }
  const r = await createAnnotation({ doc: DOC, chapter: CH, quote: "企业注册须经投资协调局审批。", now: 1, storage: store });
  assert.equal(r.status, "capped");
  assert.equal((await listChapterAnnotations("ch-1", store)).length, ANNOTATION_LIMITS.maxPerChapter, "旧记录一条不少");
});

await check("TC-UC03-01 列表按 start 升序（乱序写入也如此）", async () => {
  const store = newStore();
  const late = "相关材料包括章程。";
  const early = "企业注册须经投资协调局审批。";
  await createAnnotation({ doc: DOC, chapter: CH, quote: late, now: 2, storage: store });
  await createAnnotation({ doc: DOC, chapter: CH, quote: early, now: 1, storage: store });
  const list = await listChapterAnnotations("ch-1", store);
  assert.deepEqual(
    list.map((a) => a.quote),
    [early, late],
  );
  assert.ok(list[0].start < list[1].start, "升序保证顺序贪心（D8）成立");
});

await check("TC-UC04-01 改笔记：只有 note/updatedAt 变，区间与 id 不变", async () => {
  const store = newStore();
  const created = await createAnnotation({ doc: DOC, chapter: CH, quote: "相关材料包括章程。", now: 1, storage: store });
  const before = created.record!;
  const r = await updateAnnotationNote({ record: before, note: "改过的笔记", now: 9, storage: store });
  assert.equal(r.status, "ok");
  const after = r.record!;
  assert.equal(after.note, "改过的笔记");
  assert.equal(after.updatedAt, 9);
  assert.equal(after.id, before.id);
  assert.equal(after.quote, before.quote);
  assert.equal(after.start, before.start);
  assert.equal(after.end, before.end);

  const tooLong = await updateAnnotationNote({
    record: after,
    note: "甲".repeat(ANNOTATION_LIMITS.maxNoteChars + 1),
    now: 10,
    storage: store,
  });
  assert.equal(tooLong.status, "too-long", "超长拒绝且不写入");

  const cleared = await updateAnnotationNote({ record: after, note: "", now: 11, storage: store });
  assert.equal(cleared.record!.note, "", "清空笔记 → 退化为纯高亮（记录仍在）");
  assert.equal((await listChapterAnnotations("ch-1", store)).length, 1);
});

await check("TC-UC04-02 删除：幂等，删不存在的 id 不抛错", async () => {
  const store = newStore();
  const created = await createAnnotation({ doc: DOC, chapter: CH, quote: "相关材料包括章程。", now: 1, storage: store });
  await removeAnnotation(created.record!.id, store);
  assert.deepEqual(await listChapterAnnotations("ch-1", store), []);
  await removeAnnotation("ann_不存在", store); // 不抛错
  await removeAnnotation(created.record!.id, store); // 重复删除不抛错
});

/* ---------------- 6) 重切分后的存续（UC-05）---------------- */

// 模拟重切分：正文顺序不变，但整篇被前移/后移（旧偏移全部失效）
function resplitDoc(shift: number): SourceDocument {
  return {
    ...DOC,
    textPreview: "前".repeat(shift) + BODY + "后记",
    // ⚠️ 故意保留旧 contentRef 之外的形态：由 relinkAnnotations 重新反查
  } as SourceDocument;
}

await check("TC-UC05-01 重切分后 quote 仍在 → 重定位并改写 start/end/chapterId", async () => {
  const store = newStore();
  const quote = "企业注册须经投资协调局审批。";
  const created = await createAnnotation({ doc: DOC, chapter: CH, quote, now: 1, storage: store });
  assert.equal(created.status, "ok");

  const shifted = resplitDoc(BASE + 7); // 正文整体后移 7 个字符
  await store.saveDocument(shifted);
  await store.saveChapters(shifted.id, [
    {
      ...CH,
      contentRef: { start: BASE + 7, end: BASE + 7 + BODY.length },
    } as Chapter,
  ]);

  const outcome = await relinkAnnotations({ documentId: "doc-1", storage: store });
  assert.deepEqual(outcome, { relinked: 1, dropped: 0 });
  const list = await store.listAnnotations("doc-1");
  assert.equal(list.length, 1);
  const after = list[0];
  assert.equal(shifted.textPreview.slice(after.start, after.end), quote, "新区间仍逐字对得上");
  assert.equal(after.chapterId, "ch-1");
  assert.equal(after.note, "", "笔记不受影响");
});

await check("TC-UC05-02 重切分后 quote 消失 → 删除该条（不留孤儿）", async () => {
  const store = newStore();
  await createAnnotation({ doc: DOC, chapter: CH, quote: "企业注册须经投资协调局审批。", now: 1, storage: store });
  const replaced = { ...DOC, textPreview: "完全换了一份正文，旧句子不见了。" } as SourceDocument;
  await store.saveDocument(replaced);
  const outcome = await relinkAnnotations({ documentId: "doc-1", storage: store });
  assert.deepEqual(outcome, { relinked: 0, dropped: 1 });
  assert.deepEqual(await store.listAnnotations("doc-1"), []);
});

await check("TC-UC05-03 relink 幂等：无批注 / 位置未变时零改写", async () => {
  const store = newStore();
  assert.deepEqual(await relinkAnnotations({ documentId: "doc-1", storage: store }), {
    relinked: 0,
    dropped: 0,
  });
  await createAnnotation({ doc: DOC, chapter: CH, quote: "相关材料包括章程。", now: 1, storage: store });
  await store.saveDocument(DOC);
  await store.saveChapters("doc-1", [CH]);
  assert.deepEqual(await relinkAnnotations({ documentId: "doc-1", storage: store }), {
    relinked: 0,
    dropped: 0,
  }, "位置未变 → 不做任何写入");
});

/* ---------------- 7) 回归不变式 ---------------- */

await check("TC-REG-01 创建 → 改笔记 → 删除 后 Chapter[] 与 LearnerState 逐字节不变", async () => {
  const store = newStore();
  const chapters = [CH];
  await store.saveChapters("doc-1", chapters);
  await store.saveLearnerState({ byUnit: { "ch-1": { mastery: 0.42, attempts: 3 } } } as never);

  const chaptersBefore = JSON.stringify(await store.listChapters("doc-1"));
  const learnerBefore = JSON.stringify(await store.getLearnerState());

  const created = await createAnnotation({ doc: DOC, chapter: CH, quote: "相关材料包括章程。", note: "n", now: 1, storage: store });
  await updateAnnotationNote({ record: created.record!, note: "改了", now: 2, storage: store });
  await removeAnnotation(created.record!.id, store);

  assert.equal(JSON.stringify(await store.listChapters("doc-1")), chaptersBefore);
  assert.equal(JSON.stringify(await store.getLearnerState()), learnerBefore);
  assert.deepEqual(await store.listEvidence(), [], "划线全程不写证据流（D4）");
});

/* ---------------- 7.5) 存储契约（级联 / 幂等 / 全序排序）---------------- */

/** 直接构造一条批注记录 —— 本组只验存储契约，不经服务层（锚定正确性另有用例）。 */
function ann(id: string, doc: string, ch: string, start: number, end: number): Annotation {
  return {
    id: `ann_${id}`,
    documentId: doc,
    chapterId: ch,
    quote: "q",
    start,
    end,
    note: "",
    createdAt: 0,
    updatedAt: 0,
  };
}

await check("TC-STORE-01 deleteDocument 级联清掉该资料全部批注（且不误伤其他资料）", async () => {
  const store = newStore();
  await store.saveAnnotation(ann("a", "doc-1", "ch-1", 10, 20));
  await store.saveAnnotation(ann("b", "doc-1", "ch-2", 30, 40));
  await store.saveAnnotation(ann("c", "doc-2", "ch-9", 50, 60));

  await store.deleteDocument("doc-1");

  assert.deepEqual(await store.listAnnotations("doc-1"), [], "本资料批注必须一并清除（否则成孤儿）");
  assert.deepEqual(
    (await store.listAnnotations("doc-2")).map((x) => x.id),
    ["ann_c"],
    "**不得误伤其他资料**的批注",
  );
});

await check("TC-STORE-02 deleteAnnotations：空数组无副作用；只删列出的 id；重复删不抛错", async () => {
  const store = newStore();
  await store.saveAnnotation(ann("a", "doc-1", "ch-1", 10, 20));
  await store.saveAnnotation(ann("b", "doc-1", "ch-1", 30, 40));

  // 空数组 = 无操作（`local.ts` 亦据此短路：不做整库回写，见 TC-EDGE-10 同思路）
  await store.deleteAnnotations([]);
  assert.equal((await store.listAnnotations("doc-1")).length, 2, "空数组不得清空任何数据");

  await store.deleteAnnotations(["ann_a", "ann_a"]);
  assert.deepEqual(
    (await store.listAnnotations("doc-1")).map((x) => x.id),
    ["ann_b"],
    "只删列出的 id；重复 id 幂等",
  );

  await store.deleteAnnotation("ann_不存在");
  assert.equal((await store.listAnnotations("doc-1")).length, 1, "删不存在的 id 不抛错、不误删");
});

await check("TC-STORE-03 列表按 start 全序升序（同起点用 end 兜底，写入顺序无关）", async () => {
  const store = newStore();
  await store.saveAnnotation(ann("c", "doc-1", "ch-1", 90, 99));
  await store.saveAnnotation(ann("a", "doc-1", "ch-1", 10, 20));
  await store.saveAnnotation(ann("d", "doc-1", "ch-2", 5, 9));
  await store.saveAnnotation(ann("b", "doc-1", "ch-1", 10, 30));

  assert.deepEqual(
    (await store.listAnnotationsByChapter("ch-1")).map((x) => x.id),
    ["ann_a", "ann_b", "ann_c"],
    "同起点必须按 end 分出确定顺序（D8 顺序贪心依赖稳定序）",
  );
  assert.deepEqual(
    (await store.listAnnotations("doc-1")).map((x) => x.id),
    ["ann_d", "ann_a", "ann_b", "ann_c"],
    "资料级列表跨章合并后仍按 start 升序",
  );
});

/* ---------------- 7.6) T10：重切分 / 合并入口自动重定位（接线回归）---------------- */

await check("TC-WIRE-01 章合并入口自动重定位：批注跟随保留章（T10）", async () => {
  const store = newStore();
  const text = "第一章正文。第二章正文。";
  const doc = { id: "doc-w", title: "w", format: "pdf", textPreview: text, importedAt: 0 } as SourceDocument;
  await store.saveDocument(doc);

  const mk = (id: string, order: number, start: number, end: number): Chapter =>
    ({ id, documentId: "doc-w", title: id, order, status: "learning", keyPoints: [], keyPointRefs: [], contentRef: { start, end } }) as unknown as Chapter;
  const c1 = mk("ch-1", 1, 0, 6);
  const c2 = mk("ch-2", 2, 6, 12);
  await store.saveChapters("doc-w", [c1, c2]);

  const created = await createAnnotation({ doc, chapter: c2, quote: "第二章正文。", now: 1, storage: store });
  assert.equal(created.status, "ok", "前置条件：批注先落在 ch-2");
  const before = created.record!;

  const r = await applyChapterEdit(
    { id: "doc-w", textPreview: text },
    { storage: store, chapters: [c1, c2], edit: { kind: "merge", fromId: "ch-1", toId: "ch-2" } },
  );

  assert.equal(r.absorbed, 1, "前置条件：合并确实生效");
  assert.equal(r.annotationsRelinked, 1, "合并入口必须自动调用 relink（T10 接线）");
  assert.equal(r.annotationsDropped, 0);
  const after = (await store.listAnnotations("doc-w"))[0];
  assert.equal(after.chapterId, r.chapters[0].id, "批注必须迁移到保留章，否则成孤儿");
  assert.notEqual(r.chapters[0].id, "ch-2", "ch-2 已被并吞（确认上面的迁移不是巧合）");
  assert.equal(after.quote, before.quote, "quote 是锚定真源 → 不变");
  assert.equal(after.id, before.id, "区间未变 → 区间派生 id 不变");
  assert.equal(after.note, before.note, "重定位不得动用户笔记");
});

await check("TC-WIRE-02 重新切分入口自动重定位：陈旧 chapterId 被纠正（T10）", async () => {
  const store = newStore();
  const text = "# 甲\n\n甲甲甲甲甲甲。\n\n# 乙\n\n乙乙乙乙乙乙。";
  const doc = { id: "doc-r", title: "r", format: "md", textPreview: text, importedAt: 0 } as SourceDocument;
  await store.saveDocument(doc);

  // 刻意用「指不到任何章的」陈旧 chapterId 造数据：重切分后必须被纠正为真实归属章。
  const created = await createAnnotation({
    doc,
    chapter: { id: "ch-ghost", contentRef: { start: 0, end: text.length } },
    quote: "乙乙乙乙乙乙。",
    now: 1,
    storage: store,
  });
  assert.equal(created.status, "ok");
  assert.equal(created.record!.chapterId, "ch-ghost", "前置条件：先是一条陈旧归属");

  const res = await splitDocumentNow(doc, { storage: store, now: 2 });

  assert.equal(res.annotationsRelinked, 1, "切分入口必须自动调用 relink（T10 接线）");
  assert.equal(res.annotationsDropped, 0);
  const after = (await store.listAnnotations("doc-r"))[0];
  assert.notEqual(after.chapterId, "ch-ghost", "陈旧归属必须被纠正");
  const owner = res.chapters.find((c) => c.id === after.chapterId);
  assert.ok(owner, "纠正后的 chapterId 必须是本次切分产出的章");
  assert.ok(
    after.start >= owner.contentRef.start && after.end <= owner.contentRef.end,
    "批注区间必须完整落在归属章内",
  );
});

/* ---------------- 8) 零 AI 与文案穷尽（源码级断言）---------------- */

await check("TC-UC06-01 服务层不得依赖 AI（源码内无 ai 导入）", () => {
  const src = readFileSync(
    new URL("../src/features/learn/annotation-service.ts", import.meta.url),
    "utf8",
  );
  assert.equal(/from\s+"[^"]*\/ai\//.test(src), false, "annotation-service 不得 import src/ai/*");
  assert.equal(/import\s+type\s*\{[^}]*AIProvider/.test(src), false);
});

await check("TC-I18N-01 状态文案穷尽：AnnotationStatus 除 ok 外每个键都有 zh 文案", () => {
  const status = Object.keys(zh.learn.reader.annotations.status);
  const expected = ["unanchored", "duplicate", "too-short", "too-long", "capped", "no-body", "error"];
  for (const k of expected) {
    assert.ok(status.includes(k), `缺少状态文案：${k}`);
  }
  assert.equal(status.length, expected.length, "不得出现多余的键（防拼写漂移）");
});

/* ---------------- 9) T12 / D10：?at= 源区间 → 候选降级（§12.2 TC-ATC-*）---------------- */

await check("TC-ATC-01 候选①优先：plain 正文的源区间原样作为首选候选", () => {
  const text = "企业注册须经投资协调局审批。相关材料包括章程。";
  const at = text.indexOf("相关材料");
  assert.equal(sourceRangeCandidates(text, at, at + 4)[0], "相关材料", "原文字面必须是首候选");
});

await check("TC-ATC-02 标题行：`### ` 前缀被候选②剥掉（DOM 中不存在该前缀）", () => {
  const text = "### 6.1.3 注册程序  \n企业注册须经审批。";
  const end = text.indexOf("注册程序") + "注册程序".length; // 恰好切到标题行末（不含换行）
  const cs = sourceRangeCandidates(text, 0, end);
  assert.equal(cs[0], "### 6.1.3 注册程序", "候选①是原文（含前缀）");
  assert.ok(cs.includes("6.1.3 注册程序"), `候选②必须剥掉 ### 前缀，实际：${JSON.stringify(cs)}`);
  assert.equal(cs.filter((c) => c === "6.1.3 注册程序").length, 1, "候选不得重复");
});

await check("TC-ATC-03 闭式标题：尾部 `###` 也被剥掉", () => {
  const text = "## 第二章 注册程序 ##\n正文。";
  const cs = sourceRangeCandidates(text, 0, text.indexOf("\n"));
  assert.ok(cs.includes("第二章 注册程序"), `尾部 ### 必须剥掉，实际：${JSON.stringify(cs)}`);
  // ⚠️ 剥完短于 MIN_FRAGMENT_CHARS(4) 的标题（如 `## 第三章 ##`）宁可零候选 —— 见 T12 取舍
  assert.deepEqual(sourceRangeCandidates("## 第三章 ##\n正文。", 0, 9), ["## 第三章 ##"]);
});

await check("TC-ATC-04 加粗：`**` 抹平后重建出渲染后可见文本（②）", () => {
  const text = "重点：**必须双人复核**，然后签字。";
  const at = text.indexOf("**");
  const cs = sourceRangeCandidates(text, at, at + 12);
  assert.ok(
    cs.includes("必须双人复核"),
    `抹掉 ** 后必须出现可见文本候选，实际：${JSON.stringify(cs)}`,
  );
});

await check("TC-ATC-05 链接：`[文本](url)` → 保留文本、抹掉裸 URL（②）", () => {
  const text = "见[审批指引](https://example.com/a/b)第 3 节。";
  const at = text.indexOf("[审批指引]");
  const cs = sourceRangeCandidates(text, at, text.length);
  assert.ok(
    cs.some((c) => c.includes("审批指引") && !c.includes("https://")),
    `不得把 URL 当可见文本，实际：${JSON.stringify(cs)}`,
  );
});

await check("TC-ATC-06 列表符：`- ` 与 `1. ` 被剥掉（②），且不误伤正文中的 # 与 -", () => {
  const cs = sourceRangeCandidates("- 第一条要求\n1. 第二条要求\n", 0, 20);
  assert.ok(cs.includes("第一条要求\n第二条要求") || cs.includes("第二条要求"), `实际：${JSON.stringify(cs)}`);
  // 正文中间的 `#` / `-` 是普通字符，剥行首标记时不得碰
  const mid = sourceRangeCandidates("编号 C# 与 A-B 的差异", 0, 12);
  assert.equal(mid[0], "编号 C# 与 A-B", "候选①永远是原文，不受剥标记影响");
});

await check("TC-ATC-07 越界 / 反向 / 非法区间 → 零候选（调用方零副作用）", () => {
  const text = "abcdef";
  assert.deepEqual(sourceRangeCandidates(text, 6, 99), [], "起点已在末尾 → 无内容");
  assert.deepEqual(sourceRangeCandidates(text, 10, 12), [], "整体越界 → 无内容（不是报错）");
  assert.deepEqual(sourceRangeCandidates(text, 4, 2), [], "反向区间 → 无内容");
  assert.deepEqual(sourceRangeCandidates(text, NaN, 3), [], "NaN → 无内容");
  assert.deepEqual(sourceRangeCandidates(text, 2, Infinity), [], "Infinity → 无内容");
  assert.deepEqual(sourceRangeCandidates("", 0, 10), [], "空串 → 无内容");
});

await check("TC-ATC-08 候选③兜底：残余情形取最长纯文本片段，且短片段不入选", () => {
  const cs = sourceRangeCandidates("`a` 与 **很长的一段可见文字** 结束", 0, 22);
  assert.ok(
    cs.some((c) => c.includes("很长的一段可见文字")),
    `② 抹平后必须能重建长片段，实际：${JSON.stringify(cs)}`,
  );
  // 短片段永不作为候选（避免 2 字符在整篇里多处命中 → 错位高亮）
  const onlyShort = sourceRangeCandidates("**ab**", 0, 6);
  assert.equal(
    onlyShort.includes("ab"),
    false,
    `短片段不得成为候选，实际：${JSON.stringify(onlyShort)}`,
  );
  assert.deepEqual(
    sourceRangeCandidates("甲乙丙丁戊", 0, 2),
    [],
    "短区间 → 零候选（三档统一护栏：宁可不跳，也不错位）",
  );
});

await check("TC-ATC-09 与 DOM 文本的关系：候选①对 plain 正文等于 DOM 位置上的可见文本", () => {
  // plain 章的 DOM 文本 = plainTextToDomText(源串)（T12 的核心事实，见 TC-DOMTEXT-03）
  const dom = plainTextToDomText(BODY);
  const cs = sourceRangeCandidates(BODY, 20, 26);
  const quote = cs[0];
  assert.ok(dom.includes(quote), `候选①必须能在 DOM 文本里原样找到：${quote}`);

  // 反向对照：旧的「按源串偏移直接取 DOM 文本」会取到错位的字符（这正是被修掉的 bug）
  const naive = dom.slice(20, 26);
  assert.notEqual(naive, quote, "旧口径必然错位 —— 本断言锁死「不得回退到旧口径」");
});

await check("TC-ATC-10 上下文消歧：同一段文字出现多次时，取「前文最像」的那一处", () => {
  // 真实库实测的失败形态：同一句模板话在多处出现，取首个命中会跳到 2.6 万字符外
  const dom = "甲方应当承担违约责任。乙方应当在十日内整改。甲方应当承担违约责任。";
  const quote = "甲方应当承担违约责任。";

  // 上下文取自第 2 处之前（"乙方应当在十日内整改。"）
  const hit = bestOccurrence(dom, quote, "乙方应当在十日内整改。");
  assert.equal(hit?.start, dom.lastIndexOf(quote), "必须选中前文与上下文一致的那一处");

  // 上下文指向第 1 处（开头无前文）→ 选中第 1 处
  const first = bestOccurrence(dom, quote, "本协议自签署之日起生效。");
  assert.equal(first?.start, 0, "上下文像开头 → 取第 1 处");
});

await check("TC-ATC-11 消歧的边界：无上下文 / 无命中 / 上下文失真都不得抛错", () => {
  const dom = "abcXXXabc";
  assert.equal(bestOccurrence(dom, "abc", "")?.start, 0, "空上下文 → 退化取首个（确定性）");
  assert.equal(bestOccurrence(dom, "zzz", "任意")?.start, undefined, "无命中 → undefined");
  assert.equal(bestOccurrence("", "abc", "x")?.start, undefined, "空 DOM → undefined");
  assert.equal(bestOccurrence(dom, "", "x")?.start, undefined, "空 quote → undefined");
  // 上下文与两处都不像 → 仍需给出一个确定结果（不得抛错、不得返回 undefined）
  const ctx = bestOccurrence(dom, "abc", "完全无关的前文");
  assert.ok(ctx, "上下文失真时也必须给出确定性结果");
});

await check("TC-ATC-12 分层不变量（D6）：瞬时锚点层与持久划线层用**不同属性**，清除函数各管一层", () => {
  const src = readFileSync(
    new URL("../src/features/learn/highlight.ts", import.meta.url),
    "utf8",
  );
  // ⚠️ 必须剔注释再断言：本文件的注释里**刻意**写了旧实现 `querySelectorAll("mark")`
  // 作反面教材，不剔注释会把「解释」判成「实现」。
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  // 两层属性必须不同，否则「?at= 跳转抹掉用户划线」的老问题会复发
  assert.ok(
    /ANCHOR_ATTR\s*=\s*"data-plos-anchor"/.test(code) &&
      /ANNOTATION_ATTR\s*=\s*"data-plos-annotation"/.test(code),
    "两层 mark 必须用两个不同的 data 属性（D6）",
  );
  assert.equal(
    /querySelectorAll\(\s*["'`]mark["'`]\s*\)/.test(code),
    false,
    "禁止无差别清除全部 mark（会抹掉用户划线）",
  );
  assert.ok(
    /clearHighlights[\s\S]{0,200}mark\[\$\{ANCHOR_ATTR\}\]/.test(code),
    "clearHighlights 必须收窄到瞬时层",
  );
  assert.ok(
    /unwrapMarks[\s\S]{0,200}mark\[\$\{ANNOTATION_ATTR\}\]/.test(code),
    "unwrapMarks 必须只管持久层",
  );
});

await check("TC-ATC-13 截断边界（T12 步骤 0）：ContentTab 必须先展开全文再跳", () => {
  const src = readFileSync(
    new URL("../src/features/learn/detail/ContentTab.tsx", import.meta.url),
    "utf8",
  );
  // ⚠️ 用 lastIndexOf：文件顶部 import 行里也有 `useEffect`，取首个会切到 import
  const effect = src.slice(src.lastIndexOf("useEffect("), src.indexOf("const metaLines"));
  assert.ok(
    /at >= PREVIEW_CHARS && truncated && !showAll/.test(effect) && /setShowAll\(true\)/.test(effect),
    "at 落在未展开的截断区之后时必须先 setShowAll(true)，否则「错位跳转」会退化成「不跳转」",
  );
  assert.ok(
    effect.indexOf("setShowAll(true)") < effect.indexOf("highlightSourceRange"),
    "展开必须先于定位：顺序颠倒等于在截断后的 DOM 上匹配（必然 miss）",
  );
  // 第 2 个参数必须是本 root 实际渲染的源串（displayed），不能是全文 text
  assert.ok(
    /highlightSourceRange\(\s*root,\s*displayed,/.test(effect),
    "必须传实际渲染的源串（displayed）",
  );
});

/* ---------------- 汇总 ---------------- */

console.log(results.join("\n"));
console.log(
  failures === 0
    ? `\n全部通过（${results.length} 项）`
    : `\n${failures} / ${results.length} 项失败`,
);
process.exit(failures === 0 ? 0 : 1);

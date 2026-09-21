/**
 * 存储层下沉单测（F10 / D12–D16；方案 docs/community-knowledge-pack-design-2026-09.md §11.2 / §12.1）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:docs
 *
 * 覆盖对象：`TauriStorage` 的四条**硬逻辑** —— 迁移次序（先迁移后使用）、
 * 会话内存镜像、失败必抛错（不静默降级）、清库次序与范围。
 *
 * 手段：`new TauriStorage(fakeInvoke)` 注入一张命令路由表（内存 Map 实现命令语义，
 * **不实现真实 SQL** —— 那归 Rust 单测 `cargo test --lib`）。
 * 全程**不碰 Tauri 运行时、不起浏览器**（`rules/no-headless-browser-validation.mdc`），
 * 与「`local` 后端用最小 localStorage 替身」是同一条既有范式。
 *
 * ⚠️ 为什么这些逻辑值得单测：它们是本次最容易写错的地方，且**错了也不会报错**——
 * 迁移次序写反 = 拿旧快照覆盖新数据；载入失败静默返回空库 = 用户以为资料丢了；
 * 清库漏一步 = 半清态。
 */
import assert from "node:assert/strict";
import { TauriStorage } from "../src/storage/tauri.ts";
import { isStorageUnavailable } from "../src/storage/errors.ts";
import { installFakeLocalStorage } from "./fake-local-storage.ts";

const results: string[] = [];
let failures = 0;

function check(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  const record = (ok: boolean, detail?: string): void => {
    if (ok) results.push(`✓ ${name}`);
    else {
      failures += 1;
      results.push(`✗ ${name}\n    ${detail ?? ""}`);
    }
  };
  try {
    const out = fn();
    if (out instanceof Promise) {
      return out.then(
        () => record(true),
        (err: unknown) => record(false, err instanceof Error ? err.message : String(err)),
      );
    }
    record(true);
  } catch (err) {
    record(false, err instanceof Error ? err.message : String(err));
  }
}

/* ================================================================== */
/* 替身：假 invoke 的命令路由表                                        */
/* ================================================================== */

interface DocDto {
  id: string;
  title: string;
  format: string;
  status: string;
  importedAt: number;
  textPreview?: string;
  path?: string;
}
interface ChapterDto {
  id: string;
  documentId: string;
  ord: number;
  title: string;
  contentRefStart: number;
  contentRefEnd: number;
  status: string;
  createdAt: number;
  keyPoints: string[];
  unitIds: string[];
}

/**
 * 内存版命令实现。**语义与 Rust 对齐**（尤其中间那条 diff-delete 与空数组特判），
 * 但不写真实 SQL —— 那是 Rust 单测的职责，重复一遍只会得到两份会漂移的实现。
 */
class FakeDb {
  /** 调用序列（顺序敏感 —— 迁移次序的核心断言就读它）。 */
  readonly calls: { cmd: string; args: Record<string, unknown> }[] = [];
  readonly documents = new Map<string, DocDto>();
  /** documentId → (chapterId → dto)。 */
  readonly chapters = new Map<string, Map<string, ChapterDto>>();
  /** 命中即 reject 的命令集。 */
  readonly failOn = new Set<string>();

  invoke = <T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
    this.calls.push({ cmd, args });
    if (this.failOn.has(cmd)) return Promise.reject(new Error(`boom: ${cmd}`));
    return Promise.resolve(this.route(cmd, args) as T);
  };

  callsOf(cmd: string): { cmd: string; args: Record<string, unknown> }[] {
    return this.calls.filter((c) => c.cmd === cmd);
  }

  chapterIdsOf(documentId: string): string[] {
    return [...(this.chapters.get(documentId)?.keys() ?? [])];
  }

  private route(cmd: string, args: Record<string, unknown>): unknown {
    switch (cmd) {
      case "db_list_documents":
        return [...this.documents.values()].sort(
          (a, b) => a.importedAt - b.importedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      case "db_list_chapters_all":
        return [...this.chapters.entries()]
          .flatMap(([, m]) => [...m.values()])
          .sort(
            (a, b) =>
              (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0) ||
              a.ord - b.ord,
          );
      case "db_save_documents":
        for (const d of args.documents as DocDto[]) this.documents.set(d.id, d);
        return null;
      case "db_save_chapters": {
        const documentId = args.documentId as string;
        const list = args.chapters as ChapterDto[];
        const bucket = this.chapters.get(documentId) ?? new Map<string, ChapterDto>();
        for (const c of list) bucket.set(c.id, c);
        // diff-delete：清掉不在本次批次里的（Rust 侧同一语义）。
        const keep = new Set(list.map((c) => c.id));
        for (const id of [...bucket.keys()]) if (!keep.has(id)) bucket.delete(id);
        if (bucket.size === 0) this.chapters.delete(documentId);
        else this.chapters.set(documentId, bucket);
        return null;
      }
      case "db_delete_document":
        this.documents.delete(args.id as string);
        this.chapters.delete(args.id as string);
        return null;
      case "db_clear_library":
        this.documents.clear();
        this.chapters.clear();
        return null;
      default:
        // 不认识的命令 = 调用点写错了（例如把 db_clear_rag 写成别处）。
        throw new Error(`unexpected command: ${cmd}`);
    }
  }
}

const DOCS_FLAG = "plos.docs.migrated.v3";

function docDto(id: string, title: string, importedAt = 1): DocDto {
  return { id, title, format: "pdf", status: "ready", importedAt, textPreview: `正文-${id}` };
}
function chapterDto(id: string, documentId: string, ord: number, title: string): ChapterDto {
  return {
    id,
    documentId,
    ord,
    title,
    contentRefStart: 0,
    contentRefEnd: 10,
    status: "not-started",
    createdAt: 1,
    keyPoints: [],
    unitIds: [],
  };
}

/**
 * ⚠️ localStorage 快照里的章节是**领域对象**形态（`order` + `contentRef`），
 * **不是** DTO 形态（`ord` + `contentRefStart/End`）—— 前者是
 * `LocalStorageAdapter.persist()` 写的，后者只在 IPC 线上出现。
 * 两者混用会让 `migrateLegacyDocuments` 在 `toChapterDto` 里读到 undefined 的
 * 区间而抛错（症状是「迁移失败、静默重试」，很难定位）。
 */
function legacyChapter(id: string, documentId: string, order: number, title: string): unknown {
  return {
    id,
    documentId,
    order,
    title,
    contentRef: { start: 0, end: 10 },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

/** 在假 localStorage 上装一个 TauriStorage（构造顺序不能反：构造时就要读快照）。 */
function mount(options: { seed?: Record<string, string>; db?: FakeDb } = {}): {
  storage: TauriStorage;
  db: FakeDb;
  ls: ReturnType<typeof installFakeLocalStorage>;
} {
  const ls = installFakeLocalStorage();
  for (const [k, v] of Object.entries(options.seed ?? {})) ls.seed(k, v);
  const db = options.db ?? new FakeDb();
  return { storage: new TauriStorage(db.invoke), db, ls };
}

/* ================================================================== */
/* TC-DOC-01 · 冷启动载入 + 会话镜像                                   */
/* ================================================================== */

await check("TC-DOC-01 冷启动从 SQLite 载入，且 db_list_documents 只被调用一次", async () => {
  const db = new FakeDb();
  db.documents.set("d1", docDto("d1", "甲", 1));
  db.documents.set("d2", docDto("d2", "乙", 2));
  db.chapters.set("d1", new Map([["c2", chapterDto("c2", "d1", 2, "第二章")], ["c1", chapterDto("c1", "d1", 1, "第一章")]]));
  const { storage, ls } = mount({ db, seed: { [DOCS_FLAG]: "1" } });

  const docs = await storage.listDocuments();
  assert.equal(docs.length, 2);
  assert.deepEqual(docs.map((d) => d.title), ["甲", "乙"]);
  assert.equal(db.callsOf("db_list_documents").length, 1);

  // 章节按 order 升序（SQL 已排序，TS 侧不重排 —— 但读出来必须是升序）。
  const chapters = await storage.listChapters("d1");
  assert.deepEqual(chapters.map((c) => c.order), [1, 2]);
  assert.deepEqual(chapters.map((c) => c.title), ["第一章", "第二章"]);

  // 第二次读**不再 IPC**（会话镜像）。
  await storage.listDocuments();
  await storage.getDocument("d2");
  await storage.listChapters("d1");
  assert.equal(db.callsOf("db_list_documents").length, 1, "第二次读不该再 IPC");
  assert.equal(db.callsOf("db_list_chapters_all").length, 1, "第二次读不该再 IPC");

  ls.uninstall();
});

await check("TC-DOC-01b 缺省可选字段读回是 undefined（不是 null）", async () => {
  const db = new FakeDb();
  db.documents.set("d1", docDto("d1", "无路径"));
  const { storage, ls } = mount({ db, seed: { [DOCS_FLAG]: "1" } });
  const doc = await storage.getDocument("d1");
  assert.ok(doc);
  assert.equal(doc.path, undefined, "缺省 path 必须是 undefined");
  assert.equal(doc.textPreview, "正文-d1");
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-02 · SQLite 才是真源                                         */
/* ================================================================== */

await check("TC-DOC-02 磁盘上的旧快照不是读路径（SQLite 赢）", async () => {
  const db = new FakeDb();
  db.documents.set("d1", docDto("d1", "SQLite 里的新标题", 1));
  // 旧快照：同一个 id、旧标题。迁移**已完成**（flag 置位）→ 快照冻结，不参与读。
  const snapshot = JSON.stringify([docDto("d1", "旧快照里的旧标题", 1)]);
  const { storage, ls } = mount({ db, seed: { [DOCS_FLAG]: "1", "plos.documents": snapshot } });

  const docs = await storage.listDocuments();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].title, "SQLite 里的新标题", "读到了 localStorage 旧快照 —— 真源搞反了");
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-03 · 写成功路径：先落库、再更新镜像                          */
/* ================================================================== */

await check("TC-DOC-03 saveDocument 落库并同步镜像（紧随其后的 getDocument 见新值）", async () => {
  const { storage, db, ls } = mount({ seed: { [DOCS_FLAG]: "1" } });
  await storage.saveDocument({
    id: "d1",
    title: "新资料",
    format: "markdown",
    status: "ready",
    importedAt: 9,
    textPreview: "正文",
  });
  const sent = db.callsOf("db_save_documents");
  assert.equal(sent.length, 1);
  assert.equal((sent[0].args.documents as DocDto[])[0].title, "新资料");
  assert.equal(db.documents.get("d1")?.title, "新资料");

  const back = await storage.getDocument("d1");
  assert.equal(back?.title, "新资料");
  assert.equal(db.callsOf("db_list_documents").length, 1, "写后读不该重新 IPC（镜像已同步）");
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-04 · 写失败必抛错，且不落 localStorage（脑裂防线）           */
/* ================================================================== */

await check("TC-DOC-04 落库失败 → 抛 StorageUnavailableError，且快照逐字节不变", async () => {
  const snapshot = JSON.stringify([docDto("d1", "快照里的甲", 1)]);
  const { storage, db, ls } = mount({ seed: { [DOCS_FLAG]: "1", "plos.documents": snapshot } });
  const before = ls.raw("plos.documents");

  // 先让镜像载入成功（否则连 load 都过不去）。
  await storage.listDocuments();
  db.failOn.add("db_save_documents");

  let thrown: unknown;
  try {
    await storage.saveDocument({
      id: "d9",
      title: "写不进去",
      format: "txt",
      status: "ready",
      importedAt: 9,
    });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "落库失败必须抛错，不能静默");
  assert.ok(isStorageUnavailable(thrown), `必须是 StorageUnavailableError：${String(thrown)}`);
  assert.equal(isStorageUnavailable(thrown) ? thrown.op : "", "db_save_documents");

  // 关键：**没有**回退写 localStorage（兜底会产出脑裂库）。
  assert.equal(ls.raw("plos.documents"), before, "plos.documents 被改写了 —— 脑裂防线失守");
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-05 · 载入失败必抛错（不返回空数组、不返回旧快照）             */
/* ================================================================== */

await check("TC-DOC-05 载入失败 → 抛错，不静默返回空库", async () => {
  const db = new FakeDb();
  db.documents.set("d1", docDto("d1", "甲"));
  db.failOn.add("db_list_documents");
  const { storage, ls } = mount({ db, seed: { [DOCS_FLAG]: "1" } });

  let thrown: unknown;
  try {
    await storage.listDocuments();
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "载入失败必须抛错（返回空数组会让用户以为资料丢了）");
  assert.ok(isStorageUnavailable(thrown));
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-06 · 迁移的幂等与短路                                        */
/* ================================================================== */

await check("TC-DOC-06 首次读取触发迁移；第二次不再触发；flag 置位时一次都不调", async () => {
  const seed = {
    "plos.documents": JSON.stringify([docDto("legacy1", "遗留甲", 1), docDto("legacy2", "遗留乙", 2)]),
    "plos.chapters": JSON.stringify({
      legacy1: [legacyChapter("lc1", "legacy1", 1, "遗留一章")],
    }),
  };
  const { storage, db, ls } = mount({ seed });

  await storage.listDocuments();
  const writes = db.callsOf("db_save_documents");
  assert.equal(writes.length, 1, "首次读取应触发一次迁移写入");
  assert.equal((writes[0].args.documents as DocDto[]).length, 2, "两份遗留资料都要搬");
  assert.equal(db.callsOf("db_save_chapters").length, 1, "遗留章节也要搬");
  const sentChapters = db.callsOf("db_save_chapters")[0].args.chapters as ChapterDto[];
  assert.equal(sentChapters[0].ord, 1, "领域 order 必须映射到 DTO ord");
  assert.equal(sentChapters[0].title, "遗留一章");
  assert.equal(db.chapterIdsOf("legacy1").length, 1);
  assert.equal(ls.raw(DOCS_FLAG), "1", "迁移成功后必须置位 flag");

  await storage.listDocuments();
  assert.equal(db.callsOf("db_save_documents").length, 1, "第二次不该重复迁移");

  // flag 已置位的新实例：一次都不调。
  const db2 = new FakeDb();
  const m2 = mount({ db: db2, seed: { ...seed, [DOCS_FLAG]: "1" } });
  await m2.storage.listDocuments();
  assert.equal(db2.callsOf("db_save_documents").length, 0, "flag 置位时不该再迁移");
  assert.equal((await m2.storage.listDocuments()).length, 0, "不迁移则 SQLite 仍为空");
  m2.ls.uninstall();
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-07 · 先迁移、后写（写路径也必须过 ensureDocs）               */
/* ================================================================== */

await check("TC-DOC-07 未 hydrate 时直接写 → 调用序列必须是「迁移 → 本次写」", async () => {
  const seed = {
    "plos.documents": JSON.stringify([docDto("legacy1", "遗留甲", 1)]),
    "plos.chapters": JSON.stringify({}),
  };
  const { storage, db, ls } = mount({ seed });

  // ⚠️ 未读过任何东西，直接写 —— 若写路径漏了 ensureDocs，这里会先写、后迁移，
  //    迁移拿旧快照把刚写的内容覆盖掉（且全程不报错）。
  await storage.saveDocument({
    id: "fresh",
    title: "刚写的",
    format: "note",
    status: "ready",
    importedAt: 5,
  });

  const writes = db.callsOf("db_save_documents");
  assert.equal(writes.length, 2, `应先迁移再写，实际 ${writes.length} 次`);
  const first = (writes[0].args.documents as DocDto[]).map((d) => d.id);
  const second = (writes[1].args.documents as DocDto[]).map((d) => d.id);
  assert.deepEqual(first, ["legacy1"], `第一次应是迁移：${JSON.stringify(first)}`);
  assert.deepEqual(second, ["fresh"], `第二次应是本次写：${JSON.stringify(second)}`);
  assert.equal(db.documents.size, 2, "两份都该在库里（迁移没被跳过）");
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-08 · 迁移失败不写 flag                                       */
/* ================================================================== */

await check("TC-DOC-08 迁移抛错 → 返回 -1 且 flag 未写（下次重试）", async () => {
  const seed = {
    "plos.documents": JSON.stringify([docDto("legacy1", "遗留甲", 1)]),
    "plos.chapters": JSON.stringify({}),
  };
  const { storage, db, ls } = mount({ seed });
  db.failOn.add("db_save_documents");

  const moved = await storage.migrateLegacyDocuments();
  assert.equal(moved, -1, "失败必须如实返回 -1");
  assert.equal(ls.raw(DOCS_FLAG), null, "失败不该写 flag（否则永不重试）");
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-09 · 清库次序与范围                                          */
/* ================================================================== */

await check("TC-DOC-09 clearAll → db_clear_library 恰好一次，随后才清落盘", async () => {
  const db = new FakeDb();
  db.documents.set("d1", docDto("d1", "甲"));
  const { storage, ls } = mount({ db, seed: { [DOCS_FLAG]: "1", "plos.documents": "[]" } });
  await storage.listDocuments();

  await storage.clearAll();
  assert.equal(db.callsOf("db_clear_library").length, 1);
  assert.equal(db.documents.size, 0, "SQLite 侧应已清空");
  assert.equal(ls.raw("plos.documents"), null, "父类的 24 个 key 也应清掉");
  assert.equal((await storage.listDocuments()).length, 0);
  ls.uninstall();
});

await check("TC-DOC-09b 清库抛错 → 整体抛错且**不**继续清 localStorage（不留半清态）", async () => {
  const db = new FakeDb();
  db.documents.set("d1", docDto("d1", "甲"));
  const snapshot = JSON.stringify([docDto("d1", "甲", 1)]);
  const { storage, ls } = mount({ db, seed: { [DOCS_FLAG]: "1", "plos.documents": snapshot } });
  await storage.listDocuments();
  db.failOn.add("db_clear_library");

  let thrown: unknown;
  try {
    await storage.clearAll();
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "清库失败必须抛错（否则用户以为清干净了）");
  assert.equal(
    ls.raw("plos.documents"),
    snapshot,
    "localStorage 被清了但 SQLite 没清 —— 半清态，正是要消灭的东西",
  );
  assert.equal(db.documents.size, 1, "SQLite 侧应原样保留");
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-10 · saveChapters 是「整批替换」                             */
/* ================================================================== */

await check("TC-DOC-10 saveChapters 整批替换：入参条数 = 本次批次，陈旧章节被清掉", async () => {
  const { storage, db, ls } = mount({ seed: { [DOCS_FLAG]: "1" } });

  const mk = (id: string, order: number, title: string) => ({
    id,
    documentId: "d1",
    order,
    title,
    contentRef: { start: 0, end: 10 },
    keyPoints: ["要点"],
    unitIds: [],
    status: "not-started" as const,
    createdAt: 1,
  });

  await storage.saveChapters("d1", [mk("c1", 1, "一"), mk("c2", 2, "二"), mk("c3", 3, "三")]);
  assert.equal(db.chapterIdsOf("d1").length, 3);

  await storage.saveChapters("d1", [mk("c1", 1, "一（改）"), mk("c4", 4, "四")]);
  const last = db.callsOf("db_save_chapters").at(-1);
  assert.equal((last?.args.chapters as ChapterDto[]).length, 2, "入参就是本次批次");
  assert.deepEqual(db.chapterIdsOf("d1").sort(), ["c1", "c4"], "c2/c3 必须被清掉");

  const mirror = await storage.listChapters("d1");
  assert.deepEqual(mirror.map((c) => c.id).sort(), ["c1", "c4"], "镜像也必须同构");
  assert.equal(mirror.find((c) => c.id === "c1")?.title, "一（改）");
  ls.uninstall();
});

await check("TC-DOC-10b 空章节数组也能落库（NOT IN () 特判在 Rust，这里验调用形态）", async () => {
  const { storage, db, ls } = mount({ seed: { [DOCS_FLAG]: "1" } });
  await storage.saveChapters("d1", [
    {
      id: "c1",
      documentId: "d1",
      order: 1,
      title: "独苗",
      contentRef: { start: 0, end: 10 },
      keyPoints: [],
      unitIds: [],
      status: "not-started",
      createdAt: 1,
    },
  ]);
  await storage.saveChapters("d1", []);
  const last = db.callsOf("db_save_chapters").at(-1);
  assert.equal((last?.args.chapters as ChapterDto[]).length, 0);
  assert.equal(db.chapterIdsOf("d1").length, 0);
  assert.equal((await storage.listChapters("d1")).length, 0);
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-11 · 快照冻结：文档 / 章节不再回写 localStorage              */
/* ================================================================== */

await check("TC-DOC-11 写资料 / 章节不重写 plos.documents 与 plos.chapters（假灾备防线）", async () => {
  const snapshot = JSON.stringify([docDto("legacy1", "快照里的遗留", 1)]);
  const chaptersSnapshot = JSON.stringify({});
  const { storage, ls } = mount({
    seed: { [DOCS_FLAG]: "1", "plos.documents": snapshot, "plos.chapters": chaptersSnapshot },
  });
  await storage.listDocuments();
  await storage.saveDocument({
    id: "d-new",
    title: "新写的",
    format: "note",
    status: "ready",
    importedAt: 9,
  });
  await storage.saveChapters("d-new", []);

  assert.equal(ls.raw("plos.documents"), snapshot, "plos.documents 不该被重写（应保持迁移快照）");
  assert.equal(ls.raw("plos.chapters"), chaptersSnapshot, "plos.chapters 不该被重写");
  ls.uninstall();
});

await check("TC-DOC-11b RAG 侧的降级兜底仍会落盘（persistDocuments 是唯一被挖空的）", async () => {
  const { storage, ls } = mount({ seed: { [DOCS_FLAG]: "1" } });
  await storage.listDocuments();
  // 走 RAG 侧：假 db 没实现 db_save_sections → 抛错 → 回退父类 → 父类 persist()
  // → persistRest()（落盘）+ persistDocuments()（空操作）。
  await storage.saveSection({
    id: "s1",
    chapterId: "c1",
    documentId: "d1",
    title: "小节",
    level: 1,
    index: 0,
    contentRef: { start: 0, end: 5 },
    createdAt: 1,
  });
  assert.ok(ls.raw("plos.sections"), "RAG 侧的兜底落盘不该被一起挖空");
  assert.equal(ls.raw("plos.documents"), null, "文档 key 仍不该被写");
  ls.uninstall();
});

/* ================================================================== */
/* TC-DOC-12 · 删除资料级联                                            */
/* ================================================================== */

await check("TC-DOC-12 deleteDocument 一条命令删资料 + 其章节，镜像同步", async () => {
  const db = new FakeDb();
  db.documents.set("d1", docDto("d1", "甲"));
  db.documents.set("d2", docDto("d2", "乙", 2));
  db.chapters.set("d1", new Map([["c1", chapterDto("c1", "d1", 1, "一章")]]));
  db.chapters.set("d2", new Map([["c9", chapterDto("c9", "d2", 1, "别人的章")]]));
  const { storage, ls } = mount({ db, seed: { [DOCS_FLAG]: "1" } });

  await storage.listDocuments();
  await storage.deleteDocument("d1");

  assert.equal(db.documents.size, 1);
  assert.equal(db.chapterIdsOf("d1").length, 0, "章节应被级联删除");
  assert.equal(db.chapterIdsOf("d2").length, 1, "别人的章不该被误删");
  assert.deepEqual(
    (await storage.listDocuments()).map((d) => d.id),
    ["d2"],
  );
  assert.equal((await storage.listChapters("d1")).length, 0, "镜像里的章节也要没");
  ls.uninstall();
});

/* ================================================================== */
/* 输出                                                                */
/* ================================================================== */

for (const line of results) console.log(line);
const total = results.length;
if (failures > 0) {
  console.error(`\nstorage-documents: ${total - failures}/${total} passed, ${failures} FAILED`);
  process.exitCode = 1;
} else {
  console.log(`\nstorage-documents: ${total}/${total} passed`);
}

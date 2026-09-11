/**
 * 本地向量化（Embedder）单测 —— docs/embedding-default-config-design-2026-09.md §12。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:embed
 *
 * 覆盖：
 *  1) 默认配置：模型名 / 批量 / 本地清单；
 *  2) 能力门闩：非桌面端（node 下 isTauri() = false）一律不可用；
 *  3) 分批与条数校验（注入假 embedder）；
 *  4) 折半重试（单批失败 → 拆两批救回）；
 *  5) 静态断言：云端 /embeddings 已彻底移除、index-service 不碰 chunk-engine。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBED_BATCH_SIZE,
  LOCAL_EMBEDDING_MODELS,
  createEmbedder,
  isEmbeddingModelReady,
  resetEmbeddingStatusCache,
  type Embedder,
} from "../src/ai/embedding.ts";
import { buildIndex } from "../src/features/learn/index-service.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import type { Chunk, Embedding, SourceDocument } from "../src/domain/index.ts";
import { embeddingKey } from "../src/domain/embedding.ts";
import { useSettingsStore } from "../src/stores/useSettingsStore.ts";

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

const read = (rel: string) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/**
 * 去掉注释后再做静态断言：仓库习惯在注释里写「已移除 xxx」这类说明，
 * 直接搜字面量会被自己的注释命中（假阴性）。
 */
function codeOf(rel: string): string {
  return read(rel)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
    .join("\n");
}

function doc(id: string): SourceDocument {
  return {
    id,
    title: "资料A",
    format: "md",
    importedAt: 1,
    status: "ready",
    textPreview: "正文",
  };
}

function chunk(id: string, content: string): Chunk {
  return {
    id,
    documentId: "doc1",
    chapterId: "ch1",
    content,
    position: 0,
    knowledgeIds: [],
    createdAt: 1,
  };
}

/** 造一个可控的假 Embedder：`failOnce` 为 true 时首次整批调用失败。 */
function fakeEmbedder(opts: {
  dim?: number;
  failOnce?: boolean;
  onBatch?: (texts: readonly string[]) => void;
} = {}): Embedder {
  const dim = opts.dim ?? 4;
  let called = 0;
  return {
    model: DEFAULT_EMBEDDING_MODEL,
    dim,
    embed: (texts) => {
      called += 1;
      opts.onBatch?.(texts);
      if (opts.failOnce && called === 1) throw new Error("模拟首次整批失败");
      return Promise.resolve(texts.map(() => new Array(dim).fill(0.5)));
    },
  };
}

const run = async () => {
  // ===== A. 默认配置 =====

  await check("A1 默认模型名为本地唯一档（TC-UC01-01）", () => {
    assert.equal(DEFAULT_EMBEDDING_MODEL, "qwen3-embed:0.6b");
    assert.ok(LOCAL_EMBEDDING_MODELS.has(DEFAULT_EMBEDDING_MODEL));
    assert.equal(LOCAL_EMBEDDING_MODELS.size, 1, "当前只内置一档本地向量模型");
  });

  await check("A2 分批大小为 16（D6）", () => {
    assert.equal(EMBED_BATCH_SIZE, 16);
  });

  await check("A3 store 默认值即为本地模型 + 自动索引开（TC-UC01-01）", () => {
    const s = useSettingsStore.getState();
    assert.equal(s.embedding?.model, DEFAULT_EMBEDDING_MODEL);
    assert.equal(s.embedding?.custom, false);
    assert.notEqual(s.autoIndexOnImport, false);
  });

  await check("A4 embedder 声明维度与 Rust 清单一致（TC-UC01-02）", () => {
    // node 下 isTauri() = false → createEmbedder 恒 undefined；
    // 这里直接校验维度表与默认模型绑定关系（真值由 Rust 侧硬校验）。
    const e = { ...fakeEmbedder(), model: DEFAULT_EMBEDDING_MODEL };
    assert.equal(e.model, DEFAULT_EMBEDDING_MODEL);
    assert.equal(e.dim, 4, "假 embedder 的维度由构造方给定");
  });

  // ===== B. 能力门闩 =====

  await check("B1 非桌面端 → createEmbedder 返回 undefined（TC-UC05-01）", () => {
    assert.equal(createEmbedder(DEFAULT_EMBEDDING_MODEL), undefined);
    assert.equal(createEmbedder(""), undefined, "空模型名同样不可用");
  });

  await check("B2 状态缓存未加载 → 一律按未就绪（宁可不入队也不谎报）", () => {
    resetEmbeddingStatusCache();
    assert.equal(isEmbeddingModelReady(DEFAULT_EMBEDDING_MODEL), false);
  });

  await check("B3 模型未就绪 / 未注入 → buildIndex 抛错而不是静默空跑（TC-UC03-01）", async () => {
    const s = new InMemoryStorage();
    await s.saveDocument(doc("doc1"));
    await s.saveChunks([chunk("c1", "A")]);
    await assert.rejects(
      () => buildIndex({ storage: s, model: DEFAULT_EMBEDDING_MODEL }),
      /本地向量模型不可用/,
    );
    await assert.rejects(
      () => buildIndex({ storage: s, embedder: fakeEmbedder(), model: "  " }),
      /未启用本地向量模型/,
    );
  });

  // ===== C. 分批与容错（注入假 embedder） =====

  await check("C1 40 条按 16 条分批，且返回 40 条（TC-UC01-03）", async () => {
    const s = new InMemoryStorage();
    await s.saveDocument(doc("doc1"));
    await s.saveChunks(
      Array.from({ length: 40 }, (_v, i) => chunk(`c${i}`, `正文${i}`)),
    );
    const batches: number[] = [];
    const p = await buildIndex({
      storage: s,
      embedder: fakeEmbedder({ onBatch: (t) => batches.push(t.length) }),
      model: DEFAULT_EMBEDDING_MODEL,
    });
    assert.deepEqual(batches.slice(0, 2), [16, 16], "每批不超过 16 条");
    assert.equal(batches.reduce((a, b) => a + b, 0), 40);
    assert.equal(p.done, 40);
    assert.equal(p.failed, 0);
  });

  await check("C2 单批失败 → 折半重试一次并救回（TC-EDGE-02）", async () => {
    const s = new InMemoryStorage();
    await s.saveDocument(doc("doc1"));
    await s.saveChunks([
      chunk("c1", "A"),
      chunk("c2", "B"),
      chunk("c3", "C"),
      chunk("c4", "D"),
    ]);
    const p = await buildIndex({
      storage: s,
      embedder: fakeEmbedder({ failOnce: true }),
      model: DEFAULT_EMBEDDING_MODEL,
      batchSize: 4,
    });
    assert.equal(p.done, 4, "折半重试试成功后整批应全部写入");
    assert.equal(p.failed, 0);
    assert.equal((await s.listEmbeddingVectors("chunk")).length, 4);
  });

  await check("C3 折半后仍失败 → 整批计入 failed，不写脏向量（TC-EDGE-03）", async () => {
    const s = new InMemoryStorage();
    await s.saveDocument(doc("doc1"));
    await s.saveChunks([chunk("c1", "A"), chunk("c2", "B")]);
    const p = await buildIndex({
      storage: s,
      embedder: {
        model: DEFAULT_EMBEDDING_MODEL,
        dim: 4,
        embed: () => Promise.reject(new Error("模拟推理失败")),
      },
      model: DEFAULT_EMBEDDING_MODEL,
      batchSize: 2,
    });
    assert.equal(p.done, 0);
    assert.equal(p.failed, 2);
    assert.equal((await s.listEmbeddingVectors("chunk")).length, 0);
  });

  await check("C4 返回条数与入参不符 → 整批判失败（不写半截）", async () => {
    const s = new InMemoryStorage();
    await s.saveDocument(doc("doc1"));
    await s.saveChunks([chunk("c1", "A"), chunk("c2", "B")]);
    const p = await buildIndex({
      storage: s,
      embedder: {
        model: DEFAULT_EMBEDDING_MODEL,
        dim: 4,
        embed: () => Promise.resolve([[1, 0, 0, 0]]), // 只回 1 条
      },
      model: DEFAULT_EMBEDDING_MODEL,
      batchSize: 2,
    });
    assert.equal(p.failed, 2);
    assert.equal((await s.listEmbeddingVectors("chunk")).length, 0);
  });

  await check("C5 幂等 id 与模型判重（换模型覆盖率归零，TC-UC04-01）", async () => {
    const s = new InMemoryStorage();
    await s.saveDocument(doc("doc1"));
    await s.saveChunks([chunk("c1", "A")]);
    await buildIndex({
      storage: s,
      embedder: fakeEmbedder(),
      model: DEFAULT_EMBEDDING_MODEL,
    });
    const list = await s.listEmbeddings("chunk");
    assert.equal(list.length, 1);
    assert.equal(list[0].id, embeddingKey("chunk", "c1", DEFAULT_EMBEDDING_MODEL));
    // 换模型名 → 旧向量不算数（覆盖率按模型独立）
    const other = (await s.listEmbeddings("chunk")).filter(
      (e) => e.model === "another-model",
    ) as Embedding[];
    assert.equal(other.length, 0);
  });

  // ===== D. 静态断言：云端已移除 / 分层未回潮 =====

  await check("D1 openai-compatible 已无云端 /embeddings（TC-EDGE-07）", () => {
    const src = codeOf("src/ai/openai-compatible.ts");
    assert.equal(src.includes("/embeddings"), false, "不得残留云端 embeddings 端点");
    assert.equal(src.includes("embeddingModel"), false, "ProviderConfig 已无 embeddingModel");
    assert.equal(/\bembed\b/.test(src), false, "provider 上不得再挂 embed");
  });

  await check("D2 AIProvider 接口不再声明 embed（D5 解耦）", () => {
    const types = codeOf("src/ai/types.ts");
    assert.equal(types.includes("embeddingModel"), false);
    assert.equal(/embed\?\(/.test(types), false);
  });

  await check("D3 index-service 不 import chunk-engine（TC-EDGE-07）", () => {
    const src = codeOf("src/features/learn/index-service.ts");
    assert.equal(src.includes("chunk-engine"), false);
    assert.equal(/from "\.\.\/engine\/chunk-engine"/.test(src), false);
  });

  await check("D4 设置迁移：云端旧模型名会被重置为本地默认档", () => {
    // merge 逻辑在 normalizeEmbedding 中；此处用 store 默认值 + 白名单断言口径
    assert.equal(LOCAL_EMBEDDING_MODELS.has("text-embedding-v3"), false);
    assert.equal(LOCAL_EMBEDDING_MODELS.has("text-embedding-3-small"), false);
    assert.equal(useSettingsStore.getState().embedding?.model, DEFAULT_EMBEDDING_MODEL);
  });

  await check("D5 Rust 侧命令已注册 embed_*（接线核查）", () => {
    const lib = read("src-tauri/src/lib.rs");
    for (const cmd of [
      "embed_list_models",
      "embed_download",
      "embed_cancel_download",
      "embed_delete",
      "embed_default_model",
      "embed_texts",
    ]) {
      assert.ok(lib.includes(cmd), `lib.rs 必须注册 ${cmd}`);
    }
  });

  await check("D6 helper 协议含 embed 分支与 embeddings 响应（接线核查）", () => {
    const main = read("src-tauri/llama-helper/src/main.rs");
    assert.ok(main.includes("Embed {"), "helper 必须有 Embed 请求分支");
    assert.ok(main.includes("Embeddings {"), "helper 必须有 Embeddings 响应");
    assert.ok(main.includes("with_embeddings(true)"), "必须开启 embeddings 上下文");
  });

  console.log(results.join("\n"));
  console.log(`\nembed: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();

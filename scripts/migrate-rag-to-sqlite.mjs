#!/usr/bin/env node
/**
 * RAG 存储层迁移脚本（T9）——把 localStorage 导出的数据灌进桌面端 SQLite。
 *
 * 背景：浏览器预览（localStorage）与桌面端（SQLite）是两套后端。用户在浏览器里
 * 攒下的 Section/Chunk/Knowledge/Relation/Embedding 需要一次性搬进
 * `app_data_dir/plos.db`。日常场景其实由 TauriStorage.migrateLegacyRagData()
 * 在启动时自动完成，本脚本用于：
 *   - Dev 验证 / 排障：把导出数据灌进指定 db 后用 sqlite3 直接查表核对；
 *   - 数据抢救：localStorage 已导出成文件、桌面端又跑过一次清空的情况。
 *
 * 为什么不是 Python：设计文档 §6.2 的伪代码用的是 Python，但本仓库没有 Python
 * 依赖、Node 是唯一必装运行时，故用 Node 实现；不引 sqlite npm 包，改为生成
 * SQL 文本再交给系统自带的 sqlite3 CLI 执行（macOS / Linux 均自带）。
 *
 * 用法：
 *   # 1) 只生成 SQL（默认打印到 stdout）
 *   node scripts/migrate-rag-to-sqlite.mjs --in export.json
 *   node scripts/migrate-rag-to-sqlite.mjs --in export.json --out migrate.sql
 *
 *   # 2) 直接灌库（用系统 sqlite3，单事务执行）
 *   node scripts/migrate-rag-to-sqlite.mjs --in export.json --db ~/Library/Application\ Support/.../plos.db
 *
 *   # 3) 只想看统计（不产生 SQL）
 *   node scripts/migrate-rag-to-sqlite.mjs --in export.json --stats
 *
 * 输入格式（两种都支持）：
 *   a) 对象：{ "plos.sections": [...], "plos.chunks": [...], ... }
 *   b) 数组：[ { "key": "plos.sections", "value": [...] }, ... ]
 * 未识别的 key 会被忽略并给出提示。
 *
 * 幂等性：写语句统一用 INSERT OR REPLACE（Rust 侧为 ON CONFLICT DO UPDATE），
 * 且 chunk_knowledge / chunks_fts 先删后插，重复执行只会覆盖、不会翻倍。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const KEYS = {
  sections: "plos.sections",
  chunks: "plos.chunks",
  units: "plos.knowledge-units",
  relations: "plos.knowledge-relations",
  embeddings: "plos.embeddings",
};

// ===== CLI 参数 =====

function parseArgs(argv) {
  const args = { in: null, out: null, db: null, stats: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--stats") args.stats = true;
    else if (a === "-h" || a === "--help") args.help = true;
    else {
      console.error(`未知参数：${a}`);
      process.exit(1);
    }
  }
  return args;
}

// ===== SQL 字面量转义 =====

/** 字符串 → SQL 文本字面量；null/undefined → NULL。 */
function text(v) {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** 数字 → SQL 数值；非数字 → NULL（SQLite 列可空时）或 0（NOT NULL 时）。 */
function num(v, fallback = "NULL") {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : fallback;
}

/** JSON 数组 → JSON 文本（tags 列）。 */
function jsonText(v) {
  if (!Array.isArray(v)) return "NULL";
  return text(JSON.stringify(v));
}

// ===== 输入归一化 =====

function readExport(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(raw)) {
    // 形式 b：[{ key, value }]
    const bag = {};
    for (const item of raw) {
      if (item && typeof item.key === "string") bag[item.key] = item.value;
    }
    return bag;
  }
  return raw;
}

function pick(bag, kind) {
  const v = bag[KEYS[kind]];
  if (v === undefined) return [];
  if (Array.isArray(v)) return v;
  // 有些导出工具把值存成 JSON 字符串
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ===== SQL 生成 =====

function buildSql(bag) {
  const sections = pick(bag, "sections");
  const chunks = pick(bag, "chunks");
  const units = pick(bag, "units");
  const relations = pick(bag, "relations");
  const embeddings = pick(bag, "embeddings");

  const out = [];
  out.push("-- 由 scripts/migrate-rag-to-sqlite.mjs 生成；单事务、可重复执行。");
  out.push("BEGIN;");

  // --- sections ---
  for (const s of sections) {
    if (!s?.id) continue;
    out.push(
      "INSERT OR REPLACE INTO sections " +
        "(id, chapter_id, document_id, title, level, idx, content_ref_start, content_ref_end, created_at) VALUES (" +
        [
          text(s.id),
          text(s.chapterId),
          text(s.documentId),
          text(s.title ?? ""),
          num(s.level, "2"),
          num(s.index, "0"),
          num(s.contentRef?.start, "0"),
          num(s.contentRef?.end, "0"),
          num(s.createdAt, "0"),
        ].join(", ") +
        ");",
    );
  }

  // --- knowledge_units ---
  for (const u of units) {
    if (!u?.id) continue;
    out.push(
      "INSERT OR REPLACE INTO knowledge_units " +
        "(id, title, kind, summary, source_document_id, tags, created_at) VALUES (" +
        [
          text(u.id),
          text(u.title ?? ""),
          text(u.kind ?? "concept"),
          text(u.summary),
          text(u.sourceDocumentId),
          jsonText(u.tags),
          num(u.createdAt, "0"),
        ].join(", ") +
        ");",
    );
  }

  // --- knowledge_relations ---
  for (const r of relations) {
    if (!r?.id) continue;
    out.push(
      "INSERT OR REPLACE INTO knowledge_relations " +
        "(id, from_id, to_id, rel_type, strength, created_at) VALUES (" +
        [
          text(r.id),
          text(r.fromId),
          text(r.toId),
          text(r.type ?? "related"),
          num(r.strength),
          // 领域类型无 createdAt，与 TauriStorage.toRelationDto 一致：补迁移时刻。
          num(r.createdAt, String(Date.now())),
        ].join(", ") +
        ");",
    );
  }

  // --- chunks（含关联表与 FTS 同步）---
  for (const c of chunks) {
    if (!c?.id) continue;
    out.push(
      "INSERT OR REPLACE INTO chunks " +
        "(id, document_id, chapter_id, section_id, content, position, token_count, " +
        "metadata_heading, metadata_page, metadata_source_location, created_at) VALUES (" +
        [
          text(c.id),
          text(c.documentId),
          text(c.chapterId),
          text(c.sectionId),
          text(c.content ?? ""),
          num(c.position, "0"),
          num(c.tokenCount),
          text(c.metadata?.heading),
          num(c.metadata?.page),
          text(c.metadata?.sourceLocation),
          num(c.createdAt, "0"),
        ].join(", ") +
        ");",
    );
    // 关联关系整组重建（与 Rust db_save_chunks 同策略：先删后插）。
    out.push(`DELETE FROM chunk_knowledge WHERE chunk_id = ${text(c.id)};`);
    for (const kid of c.knowledgeIds ?? []) {
      out.push(
        `INSERT OR IGNORE INTO chunk_knowledge (chunk_id, knowledge_id) VALUES (${text(c.id)}, ${text(kid)});`,
      );
    }
    // FTS 索引同步（不用触发器，见 schema.sql 说明）。
    out.push(`DELETE FROM chunks_fts WHERE id = ${text(c.id)};`);
    out.push(
      "INSERT INTO chunks_fts (content, id, chapter_id, document_id) VALUES (" +
        [text(c.content ?? ""), text(c.id), text(c.chapterId), text(c.documentId)].join(", ") +
        ");",
    );
  }

  // --- embeddings ---
  for (const e of embeddings) {
    if (!e?.id) continue;
    out.push(
      "INSERT OR REPLACE INTO embeddings " +
        "(id, target_type, target_id, model, vector_dim, created_at) VALUES (" +
        [
          text(e.id),
          text(e.targetType),
          text(e.targetId),
          text(e.model ?? ""),
          num(e.vectorDim, "0"),
          num(e.createdAt, "0"),
        ].join(", ") +
        ");",
    );
  }

  out.push("COMMIT;");
  return {
    sql: out.join("\n") + "\n",
    counts: {
      sections: sections.length,
      chunks: chunks.length,
      units: units.length,
      relations: relations.length,
      embeddings: embeddings.length,
    },
  };
}

// ===== 主流程 =====

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.in) {
  console.log(
    "用法: node scripts/migrate-rag-to-sqlite.mjs --in <export.json> [--out <migrate.sql> | --db <plos.db>] [--stats]",
  );
  process.exit(args.help ? 0 : 1);
}

const bag = readExport(args.in);
const { sql, counts } = buildSql(bag);

const known = new Set(Object.values(KEYS));
const unknown = Object.keys(bag).filter((k) => !known.has(k));
if (unknown.length > 0) {
  console.error(`提示：忽略未识别的 key → ${unknown.join(", ")}`);
}

console.error("待迁移：", JSON.stringify(counts));

if (args.stats) process.exit(0);

if (args.db) {
  const res = spawnSync("sqlite3", [args.db], { input: sql, encoding: "utf8" });
  if (res.error) {
    console.error(`执行失败：找不到 sqlite3 CLI（${res.error.message}）`);
    console.error("可改为生成 SQL 文件后手工执行：" + "--out migrate.sql");
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`sqlite3 退出码 ${res.status}\n${res.stderr ?? ""}`);
    process.exit(res.status ?? 1);
  }
  console.error(`已写入 ${args.db}`);
} else if (args.out) {
  writeFileSync(args.out, sql, "utf8");
  console.error(`已生成 ${args.out}（${sql.length} 字节）`);
} else {
  process.stdout.write(sql);
}

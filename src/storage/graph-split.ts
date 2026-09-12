/**
 * 概念图 ↔ SQLite 行级 DTO 的**纯函数**层（拆分 / 聚合 / 删除集）。
 *
 * 为什么独立成文件：`TauriStorage` 的图读写要落 SQLite，而「图拆成两表行」
 * 「两表行聚合成图」「算删除集」都是纯数据变换——抽出来才能被 node 直跑单测
 * 覆盖（`invoke` 在 node 里不存在，IPC 路径无法单测）。
 *
 * 依赖方向：只 import `domain` 类型，不碰 Tauri / React（layer-import-boundaries）。
 * DTO 定义放在此处（而非 tauri.ts）：避免 storage 内部「纯函数 ←→ 适配器」循环，
 * tauri.ts 反向 import 本文件的 DTO。
 */
import type { KnowledgeGraph, KnowledgeRelation, KnowledgeUnit } from "../domain";

// ===== DTO：Rust db/models.rs 的 TS 镜像（字段名 camelCase）=====

export interface KnowledgeUnitDto {
  id: string;
  title: string;
  kind: string;
  summary?: string;
  sourceDocumentId?: string;
  tags: string[];
  createdAt: number;
  /** v4：ConceptEvidence 拆平四列；四列同空 = 无 evidence（不部分存）。 */
  evidenceDocumentId?: string;
  evidenceStart?: number;
  evidenceEnd?: number;
  evidenceQuote?: string;
}

export interface KnowledgeRelationDto {
  id: string;
  fromId: string;
  toId: string;
  relType: string;
  strength?: number;
  createdAt: number;
}

// ===== 领域对象 ↔ DTO =====

export function toUnitDto(u: KnowledgeUnit): KnowledgeUnitDto {
  return {
    id: u.id,
    title: u.title,
    kind: u.kind,
    summary: u.summary,
    sourceDocumentId: u.sourceDocumentId,
    tags: u.tags ?? [],
    createdAt: u.createdAt,
    // evidence 是原子三元组 + quote：只在完整时落列，缺一为整体缺省。
    ...(u.evidence
      ? {
          evidenceDocumentId: u.evidence.documentId,
          evidenceStart: u.evidence.start,
          evidenceEnd: u.evidence.end,
          evidenceQuote: u.evidence.quote,
        }
      : {}),
  };
}

export function fromUnitDto(d: KnowledgeUnitDto): KnowledgeUnit {
  const hasEvidence =
    d.evidenceDocumentId !== undefined &&
    d.evidenceStart !== undefined &&
    d.evidenceEnd !== undefined &&
    d.evidenceQuote !== undefined;
  return {
    id: d.id,
    title: d.title,
    kind: d.kind as KnowledgeUnit["kind"],
    summary: d.summary,
    sourceDocumentId: d.sourceDocumentId,
    tags: d.tags ?? [],
    createdAt: d.createdAt,
    ...(hasEvidence
      ? {
          evidence: {
            documentId: d.evidenceDocumentId as string,
            start: d.evidenceStart as number,
            end: d.evidenceEnd as number,
            quote: d.evidenceQuote as string,
          },
        }
      : {}),
  };
}

export function toRelationDto(r: KnowledgeRelation): KnowledgeRelationDto {
  return {
    id: r.id,
    fromId: r.fromId,
    toId: r.toId,
    relType: r.type,
    strength: r.strength,
    // 领域类型无 createdAt：以写入时刻补齐（SQLite 列非空）。
    createdAt: Date.now(),
  };
}

export function fromRelationDto(d: KnowledgeRelationDto): KnowledgeRelation {
  return {
    id: d.id,
    fromId: d.fromId,
    toId: d.toId,
    type: d.relType as KnowledgeRelation["type"],
    strength: d.strength,
  };
}

// ===== 拆分 / 聚合 / 删除集 =====

/** 图 → 两表行（saveGraph 的写入载荷）。 */
export function splitGraph(graph: KnowledgeGraph): {
  units: KnowledgeUnitDto[];
  relations: KnowledgeRelationDto[];
} {
  return {
    units: graph.units.map(toUnitDto),
    relations: graph.relations.map(toRelationDto),
  };
}

/**
 * 两表行 → 图（getGraph 的返回体）。
 *
 * 悬空边（from/to 任一在 units 里找不到）直接丢弃：图被「级联删除概念但残留
 * 关系」或「部分写入」破坏时，宁可少一条边也不要给出指向不存在节点的图
 * （诚实降级，GraphView 不会画出幽灵节点）。
 */
export function mergeGraph(
  units: KnowledgeUnitDto[],
  relations: KnowledgeRelationDto[],
): KnowledgeGraph {
  const ids = new Set(units.map((u) => u.id));
  return {
    units: units.map(fromUnitDto),
    relations: relations
      .filter((r) => ids.has(r.fromId) && ids.has(r.toId))
      .map(fromRelationDto),
  };
}

/** 在 `current` 中但不在 `next` 中的 id → saveGraph 的删除集合（传播移除语义）。 */
export function diffIds<T extends { id: string }>(
  current: readonly T[],
  next: readonly { id: string }[],
): string[] {
  const keep = new Set(next.map((x) => x.id));
  return current.filter((x) => !keep.has(x.id)).map((x) => x.id);
}

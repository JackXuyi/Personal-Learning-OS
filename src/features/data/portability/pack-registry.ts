/**
 * 已导入知识包记录 —— 构造 / 去重判据 / 列表投影（F10 · 方案 §8.7）。
 *
 * 不直接碰 localStorage（一律走 `StorageAdapter`）；**不产出用户文案** ——
 * `allGone` 是布尔标记，文案由 UI 经 i18n 映射（服务层零文案纪律）。
 */
import type { PackCounts } from "../../../domain";
import type { ImportedPackRecord } from "../../../storage/types";
import type { KnowledgePackFile } from "./pack-format";
import type { PackImportStats } from "./pack-import-service";

/**
 * 记录构造（去重键 = `contentHash`）。
 *
 * ⚠️ **重复导入同一份包 → 覆盖，但 `documentIds` 是累积的** —— 同一份包可以导两次
 * （用户先删了资料再重导，或分批导入）。溯源行的语义是「本机哪些资料来自这个包」，
 * 那是个**累积事实**，不是「最后一次导入带了什么」。
 *
 * ⚠️ 方案 §8.7 的签名没有 `previous`，但「累积」这件事**必须**由调用方把既有记录传进来
 * —— 本模块是纯函数，不查库（查库会引入一次额外 IO，且让「同一次读取」的口径失守）。
 */
export function recordOfPack(
  file: KnowledgePackFile,
  stats: PackImportStats,
  opts: { now: number; sourceUrl?: string; previous?: ImportedPackRecord },
): ImportedPackRecord {
  const merged = [...(opts.previous?.documentIds ?? []), ...stats.importedDocumentIds];
  return {
    contentHash: file.manifest.contentHash,
    title: file.manifest.title,
    ...(file.manifest.author !== undefined ? { author: file.manifest.author } : {}),
    ...(file.manifest.license !== undefined ? { license: file.manifest.license } : {}),
    ...(opts.sourceUrl !== undefined ? { sourceUrl: opts.sourceUrl } : {}),
    importedAt: opts.now,
    documentIds: [...new Set(merged)], // 去重：同一 id 重复导入只记一次
    counts: file.counts,
  };
}

/** 按 `contentHash` 找既有记录（「这个包导入过」提示用）。 */
export function findExisting(
  records: readonly ImportedPackRecord[],
  contentHash: string,
): ImportedPackRecord | undefined {
  return records.find((r) => r.contentHash === contentHash);
}

/** 列表行（UI 直接渲染；顺序沿用 `records` 的 `importedAt` 降序，**不在这里重排**）。 */
export interface PackRow {
  /** 供 UI 删除记录 / 判重的稳定键。 */
  contentHash: string;
  title: string;
  author?: string;
  importedAt: number;
  counts: PackCounts;
  /** **仍存在**的资料 id（失效的已过滤 —— 绝不把裸 id 交给 UI）。 */
  documentIds: string[];
  /** 该包导入的资料**全部**已不存在（记录成了孤儿）→ UI 显示「资料已删除」而非空白。 */
  allGone: boolean;
}

/**
 * 列表投影。
 *
 * ⚠️ **过滤失效 id 的唯一出处**：主体解析不到就绝不显示裸 id（本仓库的既有硬口径）。
 * 过滤与 `allGone` 判定必须**同一次遍历**产出 —— 拆两处就会出现「列表里有 2 条，
 * 却同时显示『全部已删除』」的自相矛盾。
 */
export function packRowsOf(
  records: readonly ImportedPackRecord[],
  liveDocumentIds: ReadonlySet<string>,
): PackRow[] {
  return records.map((r) => {
    const live = r.documentIds.filter((id) => liveDocumentIds.has(id));
    return {
      contentHash: r.contentHash,
      title: r.title,
      ...(r.author !== undefined ? { author: r.author } : {}),
      importedAt: r.importedAt,
      counts: r.counts,
      documentIds: live,
      // 原记录有 id 但一条都不在了 → 孤儿记录；原本就没有 id 属异常数据，不报 allGone。
      allGone: r.documentIds.length > 0 && live.length === 0,
    };
  });
}

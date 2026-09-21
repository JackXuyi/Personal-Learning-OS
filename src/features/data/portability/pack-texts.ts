/**
 * 知识包卡片的**分类 → 文案**映射（F10 · 方案 §8.12 / §8.15）。
 *
 * 为什么单独一个 `.ts` 而不是留在卡片的 `.tsx` 里：全仓纪律是
 * 「服务层只产分类，文案由 UI 映射」，而**映射本身是纯函数** —— 放在 `.tsx` 里就
 * 永远测不了（单测用 `node --experimental-strip-types` 直跑，不支持 JSX、不得
 * import `.tsx`）。抽出来后这三张表可被单测覆盖，出错模式是「某个分类没有文案」
 * → 用户看到一行空白（既没文案也没报错）。
 *
 * 三张表都是**该分类的唯一映射点**：`warningText`（导出侧警告）、
 * `errorText`（导入 / 拉取侧失败）、`packCountsText`（条数串）。
 */
import type { Messages } from "../../../i18n";
import type { PackCounts } from "../../../domain";
import type { PackWarning } from "./pack-export-service";
import type { PackErrorKind } from "./pack-format";
import type { PackImportErrorKind } from "./pack-import-service";
import type { PackRemoteErrorKind } from "./pack-remote";

/** 设置页 `settings.storage.data` 段（含 F4 的 `countLabels`）。 */
export type DataTexts = Messages["settings"]["storage"]["data"];
/** `settings.storage.data.pack` 段。 */
export type PackTexts = DataTexts["pack"];

/** 卡片能见到的全部失败分类：三处 enum 的并集 + `unknown` 兜底。 */
export type PackUiErrorKind = PackErrorKind | PackImportErrorKind | PackRemoteErrorKind | "unknown";

/** 展示用的 6 个实体计数（顺序 = 展示顺序）；`chars` 是正文规模，不在此列。 */
const COUNT_KEYS = [
  "documents",
  "chapters",
  "sections",
  "chunks",
  "knowledgeUnits",
  "knowledgeRelations",
] as const;

/**
 * 条数串：`资料 3 · 章节 44 · …`；0 值不展示（一屏 0 没有信息量）。
 *
 * ⚠️ 与 F4 `DataPortabilityCard::countsText` **同一规则、同一文案源**
 * （`d.countLabels`）—— 两处各写一份就是「两把尺子」。
 */
export function packCountsText(d: DataTexts, counts: Partial<PackCounts>): string {
  return COUNT_KEYS.filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => `${d.countLabels[k]} ${counts[k] ?? 0}`)
    .join(" · ");
}

/** 导出警告分类 → 文案。 */
export function warningText(p: PackTexts, w: PackWarning): string {
  switch (w.kind) {
    case "too-large":
      return p.warnTooLarge;
    case "doc-without-body":
      return p.warnNoBody(w.count);
    case "doc-without-chunks":
      return p.warnNoChunks(w.count);
    case "orphan-units":
      return p.warnOrphanUnits(w.count);
    case "orphan-relations":
      return p.warnOrphanRelations(w.count);
  }
}

/** 导入 / 拉取失败分类 → 文案。 */
export function errorText(kind: PackUiErrorKind, p: PackTexts): string {
  switch (kind) {
    case "not-json":
      return p.errNotJson;
    case "not-pack":
      return p.errNotPack;
    case "version-newer":
      return p.errVersionNewer;
    case "unsupported-version":
      return p.errUnsupportedVersion;
    case "corrupt":
      return p.errCorrupt;
    case "too-large":
      return p.errTooLarge;
    case "empty":
      return p.errEmpty;
    case "too-large-for-store":
      return p.errTooLargeForStore;
    case "write-failed":
      return p.errWriteFailed;
    case "quota":
      return p.errQuota;
    case "invalid":
      return p.errInvalidUrl;
    case "network":
      return p.errNetwork;
    default:
      return p.errUnknown;
  }
}

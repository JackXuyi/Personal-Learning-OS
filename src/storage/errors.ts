/**
 * 存储层错误（F10 / D12）。
 *
 * 只有这一个类，且刻意**只带分类、不带用户文案**：文案由 UI 经 i18n 映射。
 * 全仓「服务层零文案」的纪律在存储层只会更严格 —— 存储层连 UI 都不该认识。
 */

/**
 * 本机数据库（SQLite）不可用。
 *
 * 何时抛出：**真源已迁到 SQLite 的实体**（v5 起为 Document / Chapter）在读写
 * 失败时。这类失败**不允许静默降级**：
 * - RAG 五类是可重算的派生数据，回退 localStorage 最坏是「索引旧了」；
 * - 而文档是不可再生的原始资产，且 `textPreview` 是所有偏移量的基准 ——
 *   一半写在 SQLite、一半写在 localStorage 会产出**脑裂库**，
 *   比直接报错难排查得多。
 *
 * 与 `clearAll` 的既有口径同源：「要么真做，要么明确失败」。
 */
export class StorageUnavailableError extends Error {
  /** 分类。UI / 导入服务据此经 i18n 映射，**不得解析 `message`**。 */
  readonly kind = "store-unavailable";
  /** 出错的具体操作（如 `db_save_documents`）。**仅供日志排障，不面向用户。** */
  readonly op: string;

  constructor(op: string) {
    super(`storage unavailable: ${op}`);
    this.name = "StorageUnavailableError";
    this.op = op;
  }
}

/**
 * 守卫：让调用方**只凭类型**分流到「本机数据库不可用」。
 *
 * 为什么不用「`Error` + 判 `message` 子串」：message 会改、会被翻译、会被上层
 * 包装 —— 判字符串就是在建一条**隐式契约**。类型是显式的，且 `typecheck` 护着它。
 */
export function isStorageUnavailable(err: unknown): err is StorageUnavailableError {
  return err instanceof StorageUnavailableError;
}

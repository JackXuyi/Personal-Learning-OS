# RAG 存储层 FTS 中文检索修复设计（方案 A）

> 关联：`docs/storage-architecture-rag-task-runbook.md` 遗留问题 F1
> 决策来源：用户确认「D1（采用 trigram）+ D2（<3 字符 LIKE 兜底）结合」= 方案 A
> 日期：2026-09-10

## 1. 背景与问题（F1）

RAG 存储层 `chunks_fts`（FTS5 虚拟表）用于块正文全文检索。实测发现**中文子串检索完全失效**：

```sql
-- 数据：'编码器由六层堆叠而成'
MATCH '编码器'               → 0 条   ← 用户实际会这么搜
MATCH '编码器*'              → 1 条   ← 仅前缀命中
MATCH '编码器由六层堆叠而成'  → 1 条   ← 仅整句命中
```

对一个中文优先的产品，这是高等级缺陷。当前桌面端 FTS 查不到中文时，由前端降级到内存子串匹配兜底，**功能不中断但走慢路径**（数据量大时体验劣化）。

## 2. 根因

`chunks_fts` 使用 FTS5 默认 `unicode61` 分词器。该分词器按「词」切分，把连续中文整段当成**一个** token，导致子串 `编码器` 无法命中。英文因天然空格分词不受影响。

## 3. trigram 实测（sqlite 3.43.2）

改用 `tokenize = 'trigram'`（按 3 字符滑动窗口建索引）：

| 查询 | 结果 |
|------|------|
| 中文 3 字 `编码器` | ✅ 命中（彻底解决 F1） |
| 中文 2 字 `编码` | 空（trigram 要求查询 ≥3 字符） |
| 中文 1 字 `编` | 空 |
| 英文 3 字 `Att` / 整词 `Attention` / 子串 `tion` | ✅ 全部命中（比 unicode61 更宽松） |
| 大小写 `attention` | ✅ 命中（大小写不敏感） |

代价：索引体积变大；**查询词需 ≥3 字符**；存量库需 DROP + 重建 + 全量重灌。

## 4. 方案决策（方案 A）

将 D1 推荐项（采用 trigram）与 D2 推荐项（<3 字符 LIKE 兜底）绑定为一个原子决策：

- **存储层**：`chunks_fts` 切换 `trigram` 分词器；
- **查询层**：`db_fts_search` 按查询词长度路由——≥3 字符走 `MATCH`（快、准），<3 字符走回表 `LIKE`（慢、准）；
- **前端层**：已有内存子串匹配兜底，不改动。

不存在「做 trigram 但不兜底」的组合（那样中文 1–2 字会彻底搜不到，比现状更差），故两决策必须结合。

## 5. 改动清单

| 文件 | 改动 | 类型 |
|------|------|------|
| `src-tauri/src/db/schema.sql` | `chunks_fts` 加 `tokenize='trigram'`；`_schema_version` 注释升 v2 | schema |
| `src-tauri/src/db/mod.rs` | 新增 `migrate()`（v1→v2）；`init_pool` 调 `migrate`；新增 `now_ms()` | Rust |
| `src-tauri/src/db/commands.rs` | `db_fts_search` 查询路由（MATCH / LIKE / 空查询） | Rust |
| `src/storage/*` | 不改动（TS 侧已有 FTS 失败降级 + 内存兜底） | — |

## 6. 迁移策略（v1 → v2）

`mod.rs` 当前 `apply_schema` 是纯幂等 DDL（`CREATE ... IF NOT EXISTS`），**无版本迁移**。新增 `migrate()`，在 `init_pool` 跑完 `apply_schema` 后调用：

1. 读 `_schema_version` 当前 `MAX(version)`；`≥2` 直接返回（幂等）；
2. `DROP TABLE IF EXISTS chunks_fts`（删旧的 unicode61 表，否则 `CREATE IF NOT EXISTS` 跳过）；
3. 重跑 `schema.sql` 的 `CREATE IF NOT EXISTS` → 用新 trigram 定义重建 `chunks_fts`；
4. `INSERT INTO chunks_fts(...) SELECT ... FROM chunks` 全量重灌（数据不丢，仅重建索引）；
5. 写 `_schema_version` version=2（applied_at 用真实 epoch ms）。

全新库（首次启动）：`apply_schema` 直接建 trigram 表 → `migrate` 见 version=1 → 重建+重灌（空）+写 2，最终为 trigram + v2。
存量库（v1 unicode61）：`apply_schema` 跳过旧表 → `migrate` DROP→重建 trigram→重灌→写 2。

## 7. 查询路由（落地后伪代码）

```
trimmed = query.trim()
if trimmed.empty:            return []                          # 空查询不误匹配全库
use_like = trimmed.chars().count() < 3
if use_like:  WHERE c.content LIKE '%' || ? || '%'   # 过滤列用 c（回表 chunks）
else:         WHERE f.content MATCH ?                # 过滤列用 f（FTS 表）
+ 可选 AND {col}.document_id = ? / {col}.chapter_id = ?   # col = c 或 f
+ GROUP BY c.id ORDER BY c.position ASC LIMIT ?
```

## 8. 验证标准

- `cargo build`：Rust 语法 + 依赖编译通过（`sqlx::query` 运行时执行，编译期不验 SQL）；
- 系统 `sqlite3` 复测：schema.sql 经 `split_statements` 切分 20 条语句无破损；trigram 下 `MATCH '编码器'` / `MATCH 'tion'` 命中；模拟 v1→v2 迁移后索引与 `chunks` 行数一致；
- 不引入新 `npm` 依赖、不改动 TS 侧。

## 9. 风险与回滚

- **并发冲突**：`commands.rs` 曾由并行任务改动；提交前 `git status` 核对 index 集合。
- **回滚**：若 trigram 引发问题，回退本提交即可回到 unicode61 + 前端兜底；存量库 version 字段不影响旧逻辑（旧代码不读 version）。

## 10. 未做范围（严格不扩大）

- 不处理 FTS 查询特殊字符转义（原 `MATCH ?` 已有此边界，非 F1 范围）；
- 不改动 `db_save_chunks` / `db_delete_chunk` 的 FTS 同步（INSERT/DELETE 语法与分词器无关）；
- 不动 `documents` / `chapters`（仍是 localStorage source of truth）。

## 11. 提交纪律

按仓库约定：仅本地 commit 不 push；实现 / 测试 / 文档拆独立 commit；提交前核对 index 不被并行任务混入。

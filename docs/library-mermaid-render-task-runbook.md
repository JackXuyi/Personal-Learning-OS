# 资料内容预览支持 Mermaid 渲染 · 实施 Runbook

| 字段 | 内容 |
|------|------|
| 方案 | `docs/library-mermaid-render-design-2026-09.md`（D1–D4 全部取推荐项 A） |
| 状态 | **已完成**（2026-09-11） |
| 验证边界 | 纯逻辑单测 + 源码静态断言 + `vite build`；**不做**浏览器 / E2E / 截图校验（`rules/no-headless-browser-validation`） |

---

## 1. 任务执行记录

| ID | 任务 | 状态 | Outcome |
|----|------|------|---------|
| T1 | `render/mermaid-source.ts` 纯逻辑 + `test:render` 脚本 | ✅ | 围栏语言 / hast 取文 / id 净化 / 指令剥离 / 规范化 / 超限，6 组纯函数，零 React 零 DOM |
| T2 | `render/mermaid-theme.ts` 主题映射与安全基线 | ✅ | `readThemeVariables(read)` 依赖注入；`MERMAID_BASE_CONFIG` 9 项显式声明；全文件零 hex |
| T3 | `render/MermaidBlock.tsx` 状态机组件 | ✅ | 模块级单例动态 import；三类错误（语法 / 超限 / 加载失败）内部消化不外抛；源码容器常驻 DOM |
| T4 | `render/markdown-core.tsx` 接线 | ✅ | `pre` 分支围栏分派 + `inlineMarkdownComponents` 显式覆写 `pre`；`PlainPre` 抽出复用 |
| T5 | i18n `common.mermaid.*` 双语 | ✅ | zh/en 各 7 键，`test:i18n` 8/8 |
| T6 | `tests/render-mermaid.test.ts` | ✅ | 20 例（纯逻辑 15 + 静态断言 5）；`test:render` 20/20 |
| T7 | 文档同步 + 依赖 | ✅ | `mermaid@^12.0.0` 入库；回写 v2 设计 §3.3/§4.2；方案补 §13.1/§14 |
| T8 | 全量门禁与构建 | ✅ | 12 组 `test:*` 全绿；`vite build` 3.84 s；主包 +0.35% |

---

## 2. 改动清单

**新增**

- `src/features/learn/render/mermaid-source.ts`
- `src/features/learn/render/mermaid-theme.ts`
- `src/features/learn/render/MermaidBlock.tsx`
- `tests/render-mermaid.test.ts`
- 本文件 + 方案文档

**修改**

- `src/features/learn/render/markdown-core.tsx` —— 唯一接触既有渲染契约的文件（`pre` 分派 + 行内覆写 `pre` + 抽出 `PlainPre`）
- `src/i18n/messages/zh.ts` / `en.ts` —— `common.mermaid.*`
- `package.json` —— `mermaid@^12.0.0`、`test:render`
- `docs/library-detail-page-v2-design-2026-09.md` —— §3.3 / §4.2 回写

---

## 3. 实施中的两处对方案文字的修正

1. **`sanitizeSvgId` 不是单射**（`:r0:` 与 `«r0»` 都落到 `plos-mm--r0-`）。
   方案初稿 §12 的 TC-UC04-02 写成「两者必须不同」，是过强假设。已按真实保证改写为
   「同一 React 版本连续产出的 id 序列净化后两两不同」，并在 `mermaid-source.ts` 注释里如实登记该边界。
2. **`.tsx` 无法进单测**（Node 类型剥离不支持 JSX）。这不是风格偏好而是硬约束：
   凡需自动化断言的行为都必须落在 `.ts`，组件行为改用「读源码文本」的静态断言
   （TC-EDGE-08/10/11/12/13/14）。

---

## 4. 收尾核对

- `npm run test:render` → **20/20 passed**
- 既有回归：`test:i18n` 8/8 · `test:import` 20/20 · `test:extract` 13/13 · `test:chunk` 12/12 ·
  `test:retrieval` 21/21 · `test:rag` 10/10 · `test:storage` 28/28 · `test:library` 24/24 ·
  `test:goal` 7/7 · `test:scope` 3/3 · `test:eta` ALL PASS · `test:ai` 6/6
- `npx vite build` → 成功；`mermaid.core-*.js`（84.17 kB）与各图类型约 37 个独立 chunk；
  `dist/index.html` 未 `modulepreload` mermaid；入口 chunk 无 mermaid 实现（4 个特征串命中数均 0）
- 主包：**1,382.75 kB → 1,387.57 kB（+0.35%）**，基线用 `git worktree` 在 `HEAD` 独立构建取得
- ⚠️ `npm run typecheck` 有 3 条既有 `TS6133`，落在 `src/features/settings/AIModelsSection.tsx`，
  与 `HEAD` 逐字节一致 → **非本次引入**，按仓库纪律未顺手改他人文件（需其属主处理）

## 5. 未做 / 遗留

- 浏览器级观感、窄屏横向滚动、图宽自适应 → 人工待验（受 `rules/no-headless-browser-validation` 约束）；
- 真实含 Mermaid 的中文技术文档（如 `docs/*.md` 自身）端到端导入后看图 → 人工待验；
- 章行 1200 字符预览常把围栏切一半 → 该块降级为源码，属设计内可接受行为（阅读页有完整版）；
- 暗色主题适配 → 全站尚无 `.dark`，未做（方案 §2 非目标）。

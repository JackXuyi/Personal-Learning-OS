# 抽取手册：第三次出现时必须做的事

> 规则：**同一个视觉模式出现在 ≥3 个文件 → 必须抽取公共组件。**
> 本文件给计数口径、抽取步骤、命名与审稿清单。判据由 `scripts/ui-consistency-scan.mjs` 产出。

## 1. 计数口径（先把话说清楚，否则规则没法执行）

| 概念 | 定义 |
|---|---|
| 视觉模式 | 相同结构 + 相同 token 意图的一段 className。判定用 **n=4 元 utility 序列**近似 |
| 计数单位 | **文件**，同文件多次出现只算 1 处 |
| 阈值 | **≥3 处 → 必须抽取**（用户要求「超过 2 处」） |
| 第 2 处 | 允许内联复制，但 **PR 描述必须声明「第 2 处，待抽」** 并登记到台账 |
| ≤2 处 | 自由 |

为什么用文件而不是次数：同一文件里重复 5 次说明是局部循环，抽成子组件收益有限；
跨 3 个文件才真正意味着「这个模式已经逃逸出 owner 的控制范围」。

## 2. 抽取 5 步

### ① 拿证据

```bash
node scripts/ui-consistency-scan.mjs --top=30 --min-files=3
```

在 `component-catalog.md` 台账里找到该行，确认命中文件清单。**没有扫描器证据就不要声称在抽取。**

### ② 定 props 契约

- **children 优先**：能不发明 props 就不发明。`<RowHeader>标题</RowHeader>` 优于 `<RowHeader title="标题" />`。
- **className 只做追加合并**：签名收 `className?: string`，内部用 `cn(base, className)`，**不要** ` className={cn(props.className || base)}` 那种可被完全覆盖的写法 —— 覆写会让下一次漂移没有任何屏障。
- **离散变体用 `cva`**（UI Kit 层）或联合类型入参（primitives 层）；不要用 5 个 boolean props 表达一个枚举。
- 不要为「将来可能需要」预留 props。

### ③ 定落点层

| 判定 | 落点 | 能否用 i18n / store |
|---|---|---|
| 纯展示、可跨项目复用（按钮、徽标、气泡） | `src/components/ui/<kebab>.tsx`（L1） | **禁** |
| 含 PLOS 业务语义（掌握度、章节、目标） | `src/components/primitives.tsx`（L2） | 可 |
| 只在某一个 feature 内复用 | `src/features/<feature>/` | 可 |
| 壳层 / 全局导航 / 页面容器 | `src/components/layout/` | 可 |

> L1 组件的硬约束来自 `docs/ui-component-system-shadcn-design-2026-09.md` §6.1 三层架构。
> 存疑时选 **L2** —— 把业务组件塞进 `ui/` 比把纯展示组件留在 feature 里更难纠正。

### ④ 替换全部调用点

- 逐个替换，**不要漏**：扫描器给出的文件清单就是验收清单。
- **`data-testid` 平移**：原元素有 testid 的，迁移后保留同名，不要重命名（会打断 E2E）。命名新元素时按 `playwright-test-ids` 的 `<区域>-<语义>` 约定。
- i18n 键同步：如果抽取过程中把硬编码文案提出来，需要在 `messages/{zh,en}.ts` **成对**新增。

### ⑤ 复跑扫描器

```bash
node scripts/ui-consistency-scan.mjs --top=30 --min-files=3
```

该模式命中必须降到 **≤2**。在 PR 里贴前后 diff，并把 `component-catalog.md` 台账对应行更新掉。

## 3. 命名约定

| 场景 | 约定 | 例 |
|---|---|---|
| L1 文件 | kebab-case | `ui/alert-dialog.tsx` |
| L1 组件 | PascalCase，与文件名一致 | `AlertDialog` |
| L2 原语 | PascalCase，语义名不用 UI 术语 | `RowHeader` 而非 `FlexBetweenBox` |
| testid | `<区域>-<语义>` | `nav-settings`、`empty-quiz-list` |
| 导出带 `data-slot="<name>"` | L1 必带；L2 建议带 | |

**禁用词**：`Box`、`Wrapper`（不含语义）、`Common`、`Base`、`Item`（过于泛化）。名字要能让人猜到长什么样。

## 4. 例外条款

以下情况可不抽取，**但必须在文件顶部注释写明理由**：

```tsx
/**
 * 一次性首屏视觉，不走 UI Kit：本页 hero 需要 12px 超大标题与其余页面不一致。
 * 已知违反 plos-ui-system 抽取规则，豁免原因：全站唯一出现。
 */
```

允许的豁免：① 一次性首屏视觉（hero / brand block）② 第三方组件必需的内联包裹 ③ 第三方/生成层代码（`ui/` 内由 shadcn CLI 产出的部分）。
**不允许**的「理由」：改动面太大、时间不够、其他地方已经这样写了。

## 5. 审稿清单（改 UI 的 PR 必须逐条回答）

- [ ] 无一次性 hex，无 `text-slate-*` / `bg-indigo-*` 等调色板色（新增或修改的行）
- [ ] focus 环 = `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`（唯一值）
- [ ] 新增视觉模式的跨文件命中 ≤2，或已在本次 PR 中抽取
- [ ] 已复跑扫描器，该模式命中降到 ≤2，diff 已贴在 PR 描述
- [ ] 壳层容器未引入新的 `overflow-*`（会让浮层被裁）
- [ ] `data-testid` 已加；`useI18n` 双语已同步
- [ ] L1 组件未引入 `useI18n` / store

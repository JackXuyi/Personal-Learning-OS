# 设置页外层分区导航改为顶部横向 Tab 技术方案

| 字段 | 内容 |
|------|------|
| 作者 | Agent |
| 日期 | 2026-09-09 |
| 状态 | 实施中（修订 2：移除 Local-first 摘要卡） |
| 关联需求 | 用户：「阅读配置的样式布局，改成横屏 tab 切换，先生成方案」→「移除顶部的本地优先（Local-first 摘要卡），更新方案」 |

## 1. 背景

设置页（`/settings`）在 U6b 分区化（docs/ui-workbench-plan-2026-09.md §24-26）后，采用「左侧竖排分区导航 + 右侧内容」两栏布局：左侧固定 220px 竖向按钮列表承载 6 个分区（AI 模型 / 本地存储 / 学习行为 / 外观与语言 / 快捷键 / 关于），顶部另有一张 Local-first 摘要卡。

该布局与产品主壳（AppShell）的全局左侧导航形成**双重侧栏**：应用最外层已有品牌 + 分组导航的侧栏，进入设置页后又出现第二根设置专属侧栏，页面视觉冗余、主内容区被进一步压缩（`max-w-5xl` 再减 220px）。

用户提出两项调整：
1. 设置分区导航改为**顶部横向 Segment Tab**，释放横向空间、减少层级感；
2. **移除顶部 Local-first 摘要卡** —— 其信息（数据留本机 · AI 状态）与「本地存储 / AI 模型」分区内容重复，且挤占首屏；"Local-first / AI 就绪"叙事已由主壳侧栏设置项绿点 + 各分区承担，卡片价值被内容区覆盖。移除后 Tab 直接置于页面标题之下。

## 2. 方案目标

| 类型 | 描述 |
|------|------|
| **主要目标** | 设置页外层 6 分区改为「顶部横向 Segment Tab」；**删除 Local-first 摘要卡**；内容区占满整页宽 |
| **非目标** | ① AI 模型分区内部「本地模型 / API 模型」双 Tab 不动；② 不改任何分区内容组件与行为（Storage 计数、语言切换等）；③ 不新增 i18n 文案（复用 `settings.sections`）；④ 不做 URL 路由化分区；⑤ 不做 sticky Tab |
| **成功标准** | ① 6 分区在顶部横向等分胶囊中可点选切换；② Local-first 摘要卡及其 i18n 键从代码与文案中完整移除，无残留引用；③ zh / en 双语下 Tab 无文字截断；④ 窄窗口不破坏布局（可横向滚动兜底）；⑤ `npm run typecheck` 与 `npm run test:i18n` 通过 |

## 3. 项目现状

### 3.1 相关代码与模块

- **`src/features/settings/SettingsPage.tsx`（345 行 → 改后约 280 行，唯一改动组件）**
  - `const [section, setSection] = useState<SectionKey>("ai")` — 分区为本地 state；
  - 顶部摘要卡区块：`backendNoteOf` / `modelNoteOf` 两个 helper、`useSettingsStore` 的 `active/providerReady` 选择器、`buildActiveProvider().isConfigured()` liveReady 判定、整张 `<Card>` JSX（含「了解更多 →」`setSection("ai")` 按钮）——全部仅供摘要卡使用，**随卡删除**；
  - 两栏骨架：`grid lg:grid-cols-[220px_1fr]` + `<aside>` 竖排按钮 → 替换为顶部横向 Tab；
  - StorageSection「当前后端」行 `backendNoteOf(storage.name, st.localFirst)` 仍被使用 → 需保留 `storageLocal/storageMemory` 两条文案（迁移至 `storage` 对象）并改写为 `backendLabelOf(storage.name, sg)`。
- **`src/i18n/messages/zh.ts` / `en.ts`（修改）**
  - `settings.localFirst` 块（10 键：eyebrow/title/desc/storageNote/modelNote/builtinQwen/noModel/storageMemory/storageLocal/learnMore）整体删除；
  - 其中 `storageLocal` / `storageMemory` 迁入 `settings.storage` 对象（Storage 分区「当前后端」行仍用）；
  - `sections` 注释同步去掉「左分区导航」字样。
- **可复用的 Segment 视觉先例（内联实现，无公共组件）**
  - `AIModelsSection.tsx`：「本地 / API」双 Tab = `flex gap-1 rounded-lg border border-line bg-subtle p-1` + 按钮 `flex-1 rounded-md px-3 py-1.5`，选中 `bg-surface text-accent shadow-sm`。

### 3.2 相关文档与约定

- docs/ui-workbench-plan-2026-09.md（U6b 分区化）、docs/interaction-design-spec-2026-09.md（S4）、rules/react.mdc（Tailwind 4 + 语义 token）、rules/code-structure-and-dependencies.mdc（≤700 行）、rules/commit-conventions。
- i18n：`settings.sections` 六键 zh/en 文案已有、无需改动；删除键须 **zh/en 同构删除**（i18n-alignment 测试会校验）。

### 3.3 约束与依赖

- 纯前端单组件 + 双语言文件布局重构：无 store / storage / Tauri 依赖变更。
- 页面容器 `PageContainer` = `mx-auto max-w-5xl px-8 py-8`。移除摘要卡与侧栏后内容全宽 ~1024px。
- 最宽 Tab 文案 en「Appearance & language」约 21 字符：等分 ~155px/项，减 padding 后 ~130px 文本区存在贴边风险 → `whitespace-nowrap` + `overflow-x-auto` 兜底（备选：改自然宽度左对齐，验证时定夺）。

## 4. 技术架构

### 4.1 总体架构

```
PageContainer (不变)
├─ SectionTitle  标题/副标题（不变）
├─ SectionTabs   ← 新：横向 Segment Tab 栏（6 项等分）〔摘要卡已移除〕
└─ 内容区        原右侧分区内容原样前移，占满宽度
```

无状态/数据层变化：`section` 仍为 SettingsPage 本地 `useState`；`active/providerReady` 只读自 store 的选择器随摘要卡一并移除（AIModelsSection 内部有自己的 store 订阅，不受影响）。

### 4.2 布局与样式设计

| 项 | 设计 |
|----|------|
| Tab 容器 | `mt-4 flex gap-1 overflow-x-auto rounded-lg border border-line bg-subtle p-1`（紧贴标题下，原摘要卡位置让出；与 AI 双 Tab 同款容器 + 横向滚动兜底） |
| Tab 按钮 | `flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors`；选中 `bg-surface text-accent shadow-sm`，未选中 `text-ink-2 hover:bg-subtle hover:text-ink-1` |
| 内容区 | `mt-6 min-w-0`，原分区分支逐字保留 |
| 无障碍 | `role="tablist"` / `role="tab"` / `aria-selected` |
| 可测性 | `data-testid={"settings-tab-" + key}`（playwright-test-ids 约定） |

> 备选（若实现后 en 最宽标签在常见桌面窗宽下仍贴边）：Tab 按钮改 `flex-none px-3.5` 左对齐自然宽度，形态不变。

### 4.3 数据模型与 API

- **数据读写：N/A** —— 纯布局重构；不触碰任何 store 写路径 / storage / Tauri 命令。i18n 仅删除与迁移文案键，zh/en 同步。

### 4.4 状态与副作用

- 保留 `useState<SectionKey>("ai")` 与 Storage 计数 effect（L70-86 原样）；无新增副作用。

## 5. 交互流程

### 5.1 主流程

1. 用户进入设置页 → 标题下方直接是 6 项横向 Segment Tab，「AI 模型」默认选中；
2. 点击某 Tab → 选中态切换（白底 + accent 字 + 阴影），下方内容区切换到对应分区；
3. （无摘要卡「了解更多 →」入口 —— 已随卡移除。）

### 5.2 分支与异常流程

| 场景 | 触发条件 | 系统行为 | UI 反馈 |
|------|----------|----------|---------|
| 窗口变窄 | 容器宽度不足 6 项等分 | Tab 栏横向滚动，按钮不折行不截断 | 滚动条出现 |
| 长英文标签 | en「Appearance & language」贴边 | 等分 + §4.2 备选兜底 | 无截断 |

### 5.3 时序图

不适用（纯静态切换，无异步/服务交互）。

## 6. 用户用例

### UC-01：顶部 Tab 切换分区

| 项 | 内容 |
|----|------|
| 角色 | 设置页用户 |
| 前置条件 | 进入 `/settings` |
| 主流程步骤 | 1. 默认显示「AI 模型」分区 2. 依次点击 6 个 Tab 3. 观察内容区 |
| 期望结果 | Tab 高亮随点击切换，对应分区内容正确展示，无白屏无闪烁 |
| 异常/边界 | 点击当前已选中 Tab 无副作用 |

### UC-02：双语与窄窗

| 项 | 内容 |
|----|------|
| 角色 | 设置页用户 |
| 前置条件 | 界面语言 zh 或 en；窗口宽度 ≥1024px 与 ~700px 各看一次 |
| 主流程步骤 | 1. zh 下浏览 2. 切 en 浏览 3. 缩窄窗口浏览 |
| 期望结果 | 6 Tab 文字完整不截断；窄窗可横向滚动访问全部 Tab |
| 异常/边界 | en 最长标签不溢出换行 |

### UC-03：摘要卡移除后的信息可达性

| 项 | 内容 |
|----|------|
| 角色 | 设置页用户 |
| 前置条件 | 进入 `/settings`，顶部无摘要卡 |
| 主流程步骤 | 1. 查看「本地存储」Tab —— 后端与数据规模可见 2. 查看「AI 模型」Tab —— 当前 AI / 状态可见 |
| 期望结果 | 原摘要卡承载的信息在对应分区内均可获得，无信息丢失 |
| 异常/边界 | — |

## 7. 线框 UI（Wireframe）

### 7.1 SettingsPage — 默认状态（改后）

```
┌──────────────────────────────────────────────────────────────┐
│ 设置 · 系统偏好                    [副标题行]                  │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ AI 模型 │ 本地存储 │ 学习行为 │ 外观与语言 │ 快捷键 │ 关于 │ │ ← 顶部横向 Segment
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 分区内容（原右侧内容区原样，占满整行）                      │ │
│ │ e.g. AI → [Active Banner][本地/API Tab][状态卡×2]          │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- 布局说明：摘要卡已移除 → Tab 紧贴 SectionTitle 下方（`mt-4`）；Tab 与内容区间距 `mt-6`。
- 组件映射：无公共 Tab 组件，内联实现（与 AIModelsSection 双 Tab 同款视觉）。
- 设计 token：`border-line` / `bg-subtle` / `bg-surface` / `text-accent` / `text-ink-1/2` / `shadow-sm`。

### 7.2 其他状态

- **窄窗**：Tab 容器横向滚动，选中项可见。
- **空/加载/错误**：不适用 —— 分区内容现状已覆盖。

### 7.3 交互说明

- Hover：`hover:bg-subtle hover:text-ink-1`；键盘可聚焦各按钮；选中态背景 + accent 文字与内部 Tab 一致。

## 8. 涉及文件及改动伪代码

### 8.1 `src/features/settings/SettingsPage.tsx`（修改）

**改动说明**：
1. imports：移除 `useSettingsStore` / `buildActiveProvider`、`labelOfLocalModel` / `labelOfProvider`；
2. 删除 helper `backendNoteOf`（改写为 `backendLabelOf(name, sg)`）与 `modelNoteOf`；
3. 删除摘要卡 JSX 整块与 `active/providerReady/liveReady`、`lf`、`activeModelNote`；
4. 两栏骨架替换为顶部 Tab 栏 + 平级内容区（分区分支逐字保留）。

```tsx
// imports（删减后）
import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { useLangStore } from "../../stores/useLangStore";
import { useI18n, type Messages } from "../../i18n";
import { storage } from "../../stores/useLoopStore";
import AIModelsSection from "./AIModelsSection";

/** 后端徽标文案：适配器 name（local=本机 localStorage；memory=内存预览）。 */
function backendLabelOf(name: string, sg: Messages["settings"]["storage"]): string {
  return name.includes("local") ? sg.storageLocal : sg.storageMemory;
}

// 渲染：标题 → Tab 栏 → 内容（摘要卡整块已删）
<div role="tablist" className="mt-4 flex gap-1 overflow-x-auto rounded-lg border border-line bg-subtle p-1">
  {SECTION_ORDER.map((key) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={section === key}
      data-testid={`settings-tab-${key}`}
      onClick={() => setSection(key)}
      className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        section === key ? "bg-surface text-accent shadow-sm" : "text-ink-2 hover:bg-subtle hover:text-ink-1"
      }`}
    >
      {st.sections[key]}
    </button>
  ))}
</div>

<div className="mt-6 min-w-0">
  {section === "ai" ? <AIModelsSection /> : /* …原 6 分支逐字保留… */}
</div>
```

### 8.2 `src/i18n/messages/zh.ts` / `en.ts`（修改）

**改动说明**：`settings.localFirst` 整块删除；`storageLocal` / `storageMemory` 迁入 `settings.storage`（紧跟 `backend` 之后）；`sections` 注释改为顶部横向导航语义。

```ts
// zh.ts 删除前
localFirst: { eyebrow, title, desc, storageNote, modelNote, builtinQwen, noModel, storageMemory, storageLocal, learnMore }

// zh.ts 删除后 —— storage 对象补两键
storage: {
  title: "本地存储",
  desc: "…",
  backend: "当前后端",
  storageMemory: "内存（预览态）",
  storageLocal: "本机 localStorage",
  counts: "数据规模",
  // …（其余原样）
}
```

**不改动**：AIModelsSection / BuiltinModelsPanel / ApiModelsTab、任何 store/storage/domain 文件。

## 9. 任务清单（Tasks）

| ID | 任务 | 依赖 | 预估复杂度 |
|----|------|------|------------|
| T1 | i18n：zh/en 删除 `localFirst`、迁移 `storageLocal/storageMemory`、注释更新 | — | S |
| T2 | SettingsPage：删 imports/helper/摘要卡/两栏骨架 → 顶部 Tab 栏 + 内容区 | T1 | S |
| T3 | `npm run typecheck` + `npm run test:i18n` | T1/T2 | S |
| T4 | 双语与窗口宽度视觉验证（zh/en × 宽/窄窗）；必要时应用 §4.2 备选 | T3 | S |

## 10. 实施步骤

1. **步骤 1（T1）**：zh.ts/en.ts 删除 `localFirst` 块，`storageLocal/storageMemory` 迁至 `storage` 对象。
   - 验证：`npm run test:i18n` 通过（zh/en 同构）。
2. **步骤 2（T2）**：按 §8.1 改造 SettingsPage（删摘要卡与相关 helper/选择器；骨架换 Tab 栏）；`backendNoteOf` → `backendLabelOf(storage.name, sg)`。
   - 验证：全仓 grep 无 `localFirst / learnMore / backendNoteOf / modelNoteOf` 残留。
3. **步骤 3（T3）**：`npm run typecheck` 0 错误。
4. **步骤 4（T4）**：`npm run dev` → 设置页 zh/en 各验 6 Tab 切换 + 窄窗滚动；回归 Storage 计数 / 语言三选 / AI 双 Tab。

**回滚策略**：单组件 + 双 i18n 文件改动，`git checkout --` 即可完整回退；无数据/迁移副作用。

## 11. 测试方案

| 层级 | 工具/方式 | 覆盖重点 | 不负责 |
|------|-----------|----------|--------|
| 单元 | `npm run test:i18n` | zh/en 键同构（删除后无漂移） | — |
| 集成 | — | — | — |
| E2E/浏览器 | `npm run dev` + 手工走查（data-testid 预留） | Tab 切换、双语、窄窗、分区信息可达 | — |
| 手工 | 见 §12 | — | — |

### 11.2 测试环境与数据

- `npm run dev`（浏览器预览即可，无 Tauri 能力依赖）；无需 mock/fixture。

### 11.3 通过标准

`typecheck` + `test:i18n` 通过；zh/en 下 6 Tab 展示完整、点击切换正确、摘要卡及其文案键无残留；§12 用例全部通过。

## 12. 测试用例

| ID | 关联 UC | 步骤 | 输入/操作 | 期望结果 | 类型 |
|----|---------|------|-----------|----------|------|
| TC-UC01-01 | UC-01 | 1-3 | 进入设置页，依次点击 6 个 Tab | Tab 高亮随点击切换，内容区正确换区 | 手工 |
| TC-UC01-02 | UC-01 | 3 | 重复点击已选中 Tab | 无异常、不闪屏 | 手工 |
| TC-UC02-01 | UC-02 | 1-2 | zh / en 切换后浏览 6 Tab | 无文字截断、无折行 | 手工 |
| TC-UC02-02 | UC-02 | 3 | 缩窄窗口至 ~700px | Tab 栏可横向滚动，全部 Tab 可达 | 手工 |
| TC-UC03-01 | UC-03 | 1 | 查看「本地存储」Tab | 后端取值（本机 localStorage / 内存预览）正常显示 | 手工 |
| TC-UC03-02 | UC-03 | 2 | 查看「AI 模型」Tab | 当前 AI 状态横幅可见 | 手工 |
| TC-EDGE-01 | — | — | `npm run typecheck` | 0 错误 | 工具 |
| TC-EDGE-02 | — | — | `npm run test:i18n` | zh/en 键同构 | 工具 |
| TC-EDGE-03 | — | — | grep `localFirst\|learnMore\|backendNoteOf\|modelNoteOf` 于 `src/` | 无匹配 | 工具 |

### 12.1 边界与回归

| ID | 场景 | 期望 |
|----|------|------|
| TC-EDGE-01 | AI 分区内部「本地/API」双 Tab | 不受影响 |
| TC-EDGE-02 | Storage 分区计数 + 当前后端行 | 仍正确展示真实数据与后端名 |
| TC-EDGE-03 | 主壳侧栏「设置」绿点（providerReady） | 由 AppShell 自己的 store 订阅驱动，不受影响 |

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-09 | 初稿（摘要卡保留在 Tab 上方） | Agent |
| 2026-09-09 | 修订 2：移除 Local-first 摘要卡及 i18n 键，Tab 直落标题下；范围/用例/线框/测试同步更新 | Agent |

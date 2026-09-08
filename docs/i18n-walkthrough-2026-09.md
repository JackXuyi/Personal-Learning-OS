# i18n 双语回归走查矩阵（2026-09）

> 配套设计：`docs/i18n-design-2026-09.md`（D1 覆盖 UI + 引擎提示文案；§8 验证策略：禁 headless、逻辑层 Node 直跑 / 类型层 tsc / 构建层 vite build / 视觉层人工走查）。

## 1. 自动化证据（本次全部通过）

| 检查 | 命令 | 结果 |
|---|---|---|
| 字典结构对齐 + 引擎默认中文（8 项） | `npm run test:i18n` | ✅ 8/8 |
| 类型层（en 同构 = 编译期漏翻检测） | `npm run typecheck` | ✅ 0 error |
| 构建层 | `npm run build` | ✅ 477.6 kB / gzip 147.6 kB |
| UI 路径残留中文抽查（features/components 字符串字面量） | grep `\p{Han}` | ✅ 仅注释/开发者日志/内容数据（见 §3） |
| html lang 副作用 | I18nProvider | ✅ zh-CN / en 随语言切换 |

## 2. 页面 × 语言走查矩阵（人工目检清单）

- [ ] **首页 /**（HomePage） zh / en
- [ ] **学习 /learn**（ChapterCatalog → Reader → 章图谱） zh / en
- [ ] **计划 /plan**（章级队列 + reasons 引擎文案） zh / en
- [ ] **测评 /quiz**（试卷中心 / 出卷 / 答题 / 判卷 / 报告） zh / en
- [ ] **复习 /study → review-session**（含概念模式） zh / en
- [ ] **测评页 /assess**（AssessmentPage/Session，含无 AI 降级说明） zh / en
- [ ] **职业 /career** zh / en
- [ ] **学习空间 /spaces** zh / en
- [ ] **设置 /settings**（语言三选 + AI 模型中心本地/API/状态） zh / en
- [ ] 壳层：导航分组 / ⌘K 面板（中英文关键词过滤）/ 页脚 zh / en
- [ ] 引擎 reason/feedback 切语言后 **refresh 即新语言**（计划页 / 首页主 CTA）

布局 R1 抽查：英文长文案（banner 说明、reasons、settings 图例）不溢出。

## 3. 有意保留的汉字（非漏翻）

| 位置 | 内容 | 依据 |
|---|---|---|
| `loop.ts` demo 种子（goal/graph/docs） | README 职业案例内容 | D6 内容/种子数据不翻 |
| `units.ts` unitTitle demo id 回退表 | 「检索/分块/…」概念标题 | 对应种子内容 id（R4 数据原文优先） |
| `quiz-engine.ts` 「（未作答）」数据标记 | 判卷写回的固定值 | QuizReport 以字面量比对，**不可**走字典（T3d 决策） |
| `splitter-engine.ts` 文档切分回退标题 | 「未命名 / 第 N 节」 | 内容级回退；列入 backlog（二期随双语播种一并处理） |
| `quiz-engine.ts` 本地出题 prompt / quota 说明 | 「关于…以下哪项…」等 | T4 文档范围 = planner/assessment/loop；quiz-engine 题面 prompt 列为 backlog |
| console.warn（判卷/出题回退日志） | 开发者日志 | 非 UI 路径 |

## 4. 提交记录（T3a → T5）

| commit | 内容 |
|---|---|
| `8cc2c3a` | T3a 通用组件 + 首页/职业/学习空间 |
| `cd1e10d` | T3b-1 章节目录 + chapter-badge |
| `945999f` | T3b-2 导入弹窗 + 阅读页 + 概念图谱 |
| `0be14a5` | T3c 计划页 + 复习会话 + 测评页 |
| `0a344b5` | T3d 试卷流程五页 |
| `4e33039` | T3e 设置页 AI 模型中心 |
| `e6db9d1` | T4 引擎文案参数注入 + store 携带语言 |
| `2e8fea3` | T5 双语对齐单测（8 项）+ test:i18n 脚本 |

> 走查方法：预览面板 `http://localhost:1420/` → 设置页「界面语言」切 zh/en 逐页核对；引擎文案在英文态做一次 refresh（重开计划页/首页）验证新语言 reason。

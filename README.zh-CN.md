# Personal Learning OS · 个人学习操作系统

**开源、本地优先的自我学习评测系统。**

导入你自己的资料 → 自动切成章节 → 章节变成试卷 →
卷面成绩累积成掌握度模型，告诉你下一步该学什么。

[简体中文](README.zh-CN.md) · [English](README.md)

<div align="center">

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Status](https://img.shields.io/badge/status-pre--MVP-orange)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Local-first](https://img.shields.io/badge/local--first-%E6%97%A0%E9%9C%80%E8%B4%A6%E5%8F%B7-blue)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

</div>

---

> **不是又一个"和 PDF 聊天"的工具。** 大多数产品停在"这是摘要"这一步。
> PLOS 追问的是更硬的问题：**你到底学会了没有？** —— 然后用一张试卷来验证。

---

## 这是什么

Personal Learning OS（PLOS）是一个桌面应用，把你自己的资料变成 **学 → 测 → 复习** 的闭环，
并持续维护一个「你真正掌握了什么」的模型。

它围绕一个问题构建：

> **「基于我已经会的东西和我想到达的地方 —— 我现在该做什么？」**

一切都在你的机器上运行。没有账号，没有云，没有必须的后端。内置本地模型开箱即用，
装完就能开始，不需要先配一堆东西。

---

## ✨ 核心能力

### 📥 导入你自己的资料

支持 **PDF**（含双栏排版与页眉页脚修复）、**Markdown**、**纯文本**、**粘贴的笔记 / 网页摘录**、
以及 **公开 GitHub 仓库中的 Markdown**。文本编码自动嗅探（BOM / UTF-8 / GB18030），
重复导入同一来源会被识别并合并，而不是产生一堆副本。

### ✂️ 切出来的是「章」，不是「块」

按标题结构（Markdown）或段落聚类（纯文本）切分，过短的章节自动合并 ——
不会出现一个只有 200 字的"章节"。之后可选地跑一次 AI 精修来优化标题和边界，
但**切分本身是确定性代码，不是需要你去信任的模型输出**。

### 📖 学一章，然后证明它

原文和 AI 提炼的**要点卡**并排阅读，还能查看该章的**概念图谱**。
读完标记为「已学完」，或者直接去测 —— 顺序由你决定。

### 📝 跟着你的水平变的试卷

四种卷型，题目全部从你自己的章节内容生成：

| 卷型 | 范围 | 题量 | 什么时候用 |
| --- | --- | --- | --- |
| **单元测** | 1 章 | 3 道客观 + 最多 2 道主观 | 学完一章 |
| **阶段测** | 2–3 章 | 每章约 3–4 题 | 连续学完几章 |
| **综合测** | 全本 | 15–20 题（客观约 60%） | 判定目标就绪 |
| **补考卷** | 仅薄弱章 | 每章 3 题，降一档难度 | 卷面低于 60% 之后 |

难度按你当前的掌握度档位自动选择 —— 低于 40% 出记忆与理解类题，高于 70% 试卷会转向
应用与分析类题。

### 🤖 拒绝造假的判卷

客观题本地即时判分。主观题交给 AI，返回得分、书面批语，并定位回原文。
**如果没配置模型，主观题会保持 `pending` —— 应用不会替你编一个分数。**
这是设计原则，不是功能缺失。

### 📊 是掌握度模型，不是成绩单

一次测验不会直接覆盖你的进度。章掌握度按下式平滑：

```text
新掌握度 = 0.65 × 卷面成绩 + 0.35 × 历史掌握度
```

一次失手不会抹掉一个月的努力。掌握度随后按遗忘曲线**随时间衰减**（半衰期 30 天），
首页展示的永远是**此刻的估计值**，而不是上次会话留下的旧数字。

### 🔁 真的会触发的间隔重复

每次判卷和每次自评都会写入一个 `nextReviewAt` 时间戳。到期时，该章会带着复习动作
重新进入你的计划。「4 天后回来」在这里是一个真实调度的任务，不是一句 UI 文案。

### 🎯 用目标圈定整个闭环

创建一个学习目标（职业 / 学业 / 考试 / 个人 / 研究 / 项目），并勾选计入该目标的章节。
规划器随后按六个优先类排序你的下一步动作 ——

```text
0  重学薄弱章      （掌握度最低，最紧迫）
1  补考未达标章
2  复习要点
3  测验已学章
4  到期的间隔复习
5  推进下一新章
```

同类内按前置依赖阻塞状态、到期时间、掌握度、文档顺序排列。
每个推荐都带一句人话理由（「当前掌握度 28%，前置已达标」）。

**目标就绪度 = 范围内达到 80% 掌握度的章节占比。**

### 🔍 覆盖全部资料库的混合检索

全文检索（SQLite FTS5）与本地向量检索通过 RRF（倒数排名融合）合并。
提问会得到锚定回原文具体段落的答案。如果嵌入模型不可用，检索会静默降级为全文搜索，
而不是直接报错。

### 🔒 本地优先

没有账号，没有埋点，没有强制的 API Key。文档、章节、向量、测验历史、学习者模型
全部存在你机器上的 SQLite 数据库里。云端供应商是可选项，不是前提。

---

## 🚀 快速开始

### 环境要求

- **Node.js ≥ 22**（npm 10+）
- **Rust 工具链**（`cargo` ≥ 1.77）—— 仅在跑桌面壳时需要

> 用 rustup 装的 Rust，新开的 shell 会自动加载 `~/.cargo/env`。
> 如果提示 `cargo: command not found`，先执行 `. "$HOME/.cargo/env"`。

### 跑网页版（不需要 Rust）

```bash
git clone https://github.com/JackXuyi/Personal-Learning-OS.git
cd Personal-Learning-OS
npm install
npm run dev          # → http://localhost:1420
```

浏览器模式是做前端开发最快的方式，改动即热更新，数据存在 localStorage。

### 跑完整桌面应用

```bash
. "$HOME/.cargo/env"   # 如果 cargo 还不在 PATH 里
npm run tauri dev
```

一条命令启动 Vite、编译 Rust、打开原生窗口。改 `src/` 页面热更新，改 `src-tauri/`
自动重新编译并重启窗口。首次 Rust 编译耗时较长，属正常。

> 不要同时跑 `npm run dev` 和 `npm run tauri dev`。两者都要占 1420 端口，
> 第二个会因 `strictPort` 冲突失败。

### 构建发布版

```bash
. "$HOME/.cargo/env"
npm run tauri build
```

产物在 `src-tauri/target/release/`。当前安装包打包已关闭
（`tauri.conf.json` 里 `bundle.active = false`），只会生成可执行文件。

### 上手十分钟

```text
1. 导入一份资料        →  PDF、Markdown，或直接粘贴笔记
2. 检查章节切分        →  边界不对就重新切分或跑 AI 精修
3. 读一章              →  读完点「已学完」
4. 做这一章的单元测    →  客观题即时出分
5. 看报告              →  逐章掌握度 + 测验前后对比
6. 跟着计划走          →  应用告诉你下一步做什么，以及为什么
```

---

## 📖 运行原理

### 评测闭环

```text
章节
   │
   ├── createPaper(scope)          本地确定性出题
   │        └── AI 只改写题面措辞 —— 绝不改动题型配比
   │
   ├── 作答                        草稿自动保存，键盘流操作
   │
   ├── gradePaper
   │        ├── 客观题  →  本地即时判分
   │        └── 主观题  →  AI 得分 + 批语 + 原文定位
   │                        （未配置模型时保持 pending）
   │
   ├── PaperResult
   │        ├── 逐章得分与掌握度前后对比
   │        ├── 错题回顾 + AI 批语
   │        └── 薄弱要点清单
   │
   └── applyPaperResult
            ├── 掌握度 = 0.65 × 卷面 + 0.35 × 历史
            ├── 更新置信度 / 尝试数 / 正确数
            └── 写入下次复习时间
```

### 章节状态机

```text
未开始 ──打开阅读──▶ 学习中 ──标记学完──▶ 已学完
                                            │
                        卷面 ≥ 0.8 ──────────┼──────▶ 已掌握
                                            │
                        卷面 < 0.6 ──────────┴──────▶ 待补考
                                                        │
                                    0.6–0.8（原待补考）──┘──▶ 已学完
```

### 计划优先级

规划器把所有候选动作归入六个优先类：

```text
0  重学薄弱章      （掌握度最低，最紧迫）
1  补考未达标章
2  复习要点
3  测验已学章
4  到期的间隔复习
5  推进下一新章
```

同类内依次按「是否被前置阻塞 → 到期时间 → 掌握度 → 文档顺序」排列。
每个动作都附带一句人话理由。

### 目标闭环

```text
学习目标  →  圈选章节  →  buildChapterPlan
                              │
                       actions[0] = 「今日主行动」
                              │
                       测验 → 掌握度 → 就绪度
                              │
                  就绪度 = 达标章节（≥ 80%）占比
                              │
                          回到计划
```

两个闭环在 `LearningGoal.requiredChapterIds` 处交汇 —— 导入管线产出的章节，
正好就是目标所圈定的那批章节。

---

## 🏗️ 架构

```text
┌───────────────────────────────────────────────────────┐
│  Tauri 2 桌面壳（Rust）                                │
│  vault（系统钥匙串）· llm（本地模型 sidecar）· db      │
│  SQLite：FTS5 全文检索 + 向量索引                      │
├───────────────────────────────────────────────────────┤
│  React 19 + TypeScript + Vite + Tailwind 4 + Zustand  │
├───────────────────────────────────────────────────────┤
│  features/   learn · quiz · report · plan · goals     │
│              assessment · learner · home · settings   │
├───────────────────────────────────────────────────────┤
│  engine/     splitter · chunk · graph · knowledge     │
│              learner-model · mastery · quiz           │
│              assessment · learning-planner            │
│              recommendation · loop（编排）             │
├───────────────────────────────────────────────────────┤
│  domain/     纯 TS 类型与阈值（不依赖 React）          │
│  ai/         供应商抽象 + 本地 map-reduce 流水线       │
│  storage/    StorageAdapter → sqlite / local / memory │
└───────────────────────────────────────────────────────┘
```

依赖严格单向：`domain → engine/ai/storage → stores → features`。
`engine/` 层是纯函数 —— 不含 React、不做 I/O —— 所以可以完整地做单元测试。

### 目录结构

```text
src/
  domain/      核心类型与阈值，纯 TS
  engine/      10 个纯逻辑引擎 + loop 编排
  ai/          供应商抽象、embedding、map-reduce 流水线
  storage/     StorageAdapter（sqlite / local / memory）
  stores/      Zustand 状态
  features/    按域分组的页面
  components/  应用外壳与共享 UI 原语
  i18n/        双语字典（zh + en）
tests/         25 个纯逻辑测试文件，node 直跑
docs/          设计文档与架构决策
rules/         面向 AI 助手的仓库约束
skills/        面向 AI 助手的可复用工作流
src-tauri/     Rust 壳 —— vault · llm · db（SQLite / FTS5 / 向量）
scripts/       数据迁移与一致性工具
```

### 存储后端

存储藏在统一的 `StorageAdapter`（`src/storage/types.ts`）之后，
业务代码永远不知道拿到的是哪一个：

| 后端 | 环境 | 落盘位置 | 说明 |
| --- | --- | --- | --- |
| `tauri` | 桌面 | `app_data_dir/plos.db` | SQLite；chunk、向量、FTS5 |
| `local` | 浏览器预览 | localStorage | 刷新保留；桌面端降级目标 |
| `memory` | 测试 / SSR | 进程内 `Map` | 无副作用 |

数据层级：`Document → Chapter → Section → Chunk`。
Chunk 是嵌入与检索的最小单位，Chapter 是学习与评测的最小单位。

桌面端若 `db_*` 命令失败，调用会回退到 localStorage —— 应用不会因为存储故障而不可用。

---

## 🧪 开发

```bash
npm run typecheck        # tsc --noEmit —— 必须 0 错误
npm run build            # typecheck + 生产构建
npm run test:library     # 章节、要点、概览与 AI map-reduce
npm run test:rag         # 检索接线
npm run test:ai          # AI 流水线
npm run test:graph       # 图谱切分与前置规划
npm run test:i18n        # 双语字典对齐
```

单独跑一个测试：

```bash
node --experimental-strip-types --no-warnings \
  --import ./tests/register-loader.mjs tests/rag-wiring.test.ts
```

Rust 侧：

```bash
cd src-tauri && cargo test --lib
```

项目**没有 ESLint / Prettier**，跟随文件自身风格。真正卡口的是 `npm run typecheck`。

---

## 🔌 AI 供应商

AI 被一个接口从业务逻辑中彻底解耦，供应商可以自由替换：

```ts
interface AIProvider {
  chat(input: ChatInput): Promise<ChatOutput>
  extractKnowledge(document: Document): Promise<Knowledge[]>
  generateAssessment(context: AssessmentContext): Promise<Question>
  evaluateAnswer(question: Question, answer: Answer): Promise<Evaluation>
}
```

**默认内置且已激活 —— 无需额外安装：**

| 模型 | 用途 |
| --- | --- |
| `qwen3.5:4b`（默认） | 文本生成、判卷、抽取 |
| `qwen3.5:2b` / `0.8b` / `9b` | 更小 / 更大的备选 |
| `qwen3-embed:0.6b` | 本地嵌入，1024 维 |

应用通过内置的 `llama-helper` sidecar 自行下载并加载模型 —— 完全离线。
Ollama、llama.cpp、LM Studio 以及 OpenAI 兼容端点（OpenAI、Anthropic、Gemini、DeepSeek、
自建服务）都可以在设置里切换。

> API Key 存放在操作系统钥匙串里，绝不写入 localStorage。

---

## 🔒 隐私与本地优先

默认姿态是 **无账号、无云端、无强制后端**。

```text
文档 · 章节 · 笔记 · 向量
测验历史 · 学习者模型 · 掌握度数据
```

全部留在你自己的机器上。核心能力 —— 导入、切分、学习、出卷、判卷、规划 ——
任何时候都不依赖网络请求。

### 产品原则

1. **数据属于你** —— 随时可以导出并离开。
2. **本地优先** —— 联网是增强项，不是依赖项。
3. **模型无关** —— 永不绑定任何单一厂商。
4. **证据可溯** —— 每一个掌握度数字都能沿着
   `原文 → 知识 → 题目 → 作答 → 评价 → 掌握度` 回溯。
5. **数字诚实** —— 判不了就说判不了，不猜。

---

## 🗺️ 功能清单

项目打算交付的全部能力，同时充当路线图。
`[x]` = 已实现 · `[ ]` = 未实现 · `P0` / `P1` / `P2` = 未实现项的优先级。

**已实现 28 项 · 未实现 16 项。**

### 📥 资料接入

- [x] PDF / Markdown / TXT / 粘贴文本 / GitHub 仓库导入
- [x] 编码嗅探（BOM / UTF-8 / GB18030）与重复导入合并
- [x] 导入后 AI 整理 —— 后台生成资料标题（手填标题不被覆盖）与整篇概览
- [ ] 扫描件 PDF 的 OCR 兜底 `P2` —— 纯图片 PDF 经 pdfjs 解析为 0 字符
- [ ] DOCX 解析 `P2`
- [ ] EPUB 解析 `P2`
- [ ] 通过 URL 抓取网页 `P2`

### ✂️ 切分与结构

- [x] 确定性章节切分（标题树 / 段落聚类）+ 短章自动合并
- [x] 可选的 AI 章节标题与边界精修
- [x] 章节重命名 / 合并 / 拖拽排序 —— 章节列表支持编辑模式，操作即时保存
- [ ] 手动把一章拆成两章 `P2`
- [ ] 跨文档组成学习单元 / 学习路径 `P2`
- [ ] 人工调整章节前置关系 `P2`

### 📖 学习

- [x] 章节阅读器 —— 原文与 AI 要点卡并排
- [x] 章级概念图谱
- [x] 章内提问（答案基于你自己的原文）—— 每条引用都可点回原文并高亮
- [ ] 划线高亮与笔记 `P1`
- [x] 费曼式复述 —— 用自己的话讲一遍本章；AI 对照章正文给出差距（讲到了 / 漏掉了 / 讲岔了，每条都可点回原文），并可据此安排复习（不动掌握度）
- [x] 由要点卡一键生成自测卡 —— 一键把本章带原文出处的要点收进**卡级**间隔重复队列（四档自评 · 1/2/4/7 天 · 不动掌握度，**无 AI 也完全可用**）
- [ ] 跨文档概念图谱 `P2`

### 📝 评测

- [x] 4 种卷型 —— 单元 / 阶段 / 整本 / 重考，难度自适应
- [x] 客观题本地即时判分
- [x] 主观题 AI 批改：评分 + 批语 + 原文指针
- [x] 报告页 —— 逐章掌握度前后对比、错题、薄弱要点
- [x] 掌握度平滑：`0.65 × 卷面 + 0.35 × 原掌握度`
- [x] 遗忘曲线 —— 半衰期 30 天
- [x] 间隔重复：`nextReviewAt` → 复习队列
- [ ] 目标级能力评测 `P1` —— 卡在产品定义尚未澄清

### 🎯 目标与计划

- [x] 六类学习目标 + 章节圈定（`requiredChapterIds`）
- [x] 六级优先级计划器；每项动作都带生成理由
- [x] 就绪度 = 圈定章节中掌握度 ≥ 80% 的占比
- [x] 学习者画像 —— 自评水平、每周时间预算、学习偏好；影响出卷难度、预计完成日与 AI 上下文
- [x] 简历导入 —— 从 PDF 或粘贴文本解析出背景摘要 + 水平建议（发送前本机掩码脱敏；原文不落库）
- [ ] 计划的时间维度 —— 每日配额、落后/超前预警 `P1`
- [ ] 复盘与趋势 —— 活动热力图、掌握度趋势、弱点排行 `P1`

### 🔍 检索

- [x] 混合检索 —— SQLite FTS5 + 本地向量，RRF 融合；结果锚回原文
- [x] 嵌入模型不可用时静默降级为全文检索

### 🔒 数据与可携带

- [x] 单一 `StorageAdapter` 覆盖 SQLite / localStorage / 内存
- [x] 内置本地模型 —— 完全离线，无账号、无遥测、无需 API Key
- [x] append-only 证据流（`EvidenceEntry`）
- [ ] 全量导出 / 导入 / 备份 `P0` —— README 承诺“随时导出离开”，但存储层目前没有任何导出方法
- [ ] 单章 Markdown 导出 `P0`
- [ ] 社区知识包 `P2`
- [ ] 加密同步 *（Pro 层）* `P2`

---

## 🤝 参与贡献

欢迎任何形式的贡献 —— 地基仍在成型，正是发表意见最好的时候。

- **想法与反馈** —— 开 issue 讨论掌握度模型、试卷设计或路线图。
- **设计** —— 参与概念图谱建模、评测设计或学习者模型。
- **代码** —— 从上面的功能清单里挑一项未勾选的，提 PR。
- **文档** —— 改进这份 README，或在 `docs/` 下补一篇设计文档。

**提 PR 之前：**

```bash
npm run typecheck    # 必须 0 错误
npm run test:library # 以及你的改动涉及的其他测试组
```

标准 GitHub 流程：fork → branch → PR。提交信息遵循 Conventional Commits。保持友善。

如果你在用 AI 助手写代码，让它先读 [`AGENTS.md`](AGENTS.md) —— 里面索引了
`rules/` 中的仓库约束和 `skills/` 中的工作流。

---

## 📄 许可证

[MIT](LICENSE) © 2026 JackXuyi

你的知识属于你。你的学习记录属于你。你的掌握度模型属于你。

<div align="center">

**如果这个项目对你有用，一个 ⭐ 能帮更多学习者找到它。**

</div>

# AI 模型中心方案:本地模型 × API 模型(交互 + 设置页重构)

> 状态:M0-M2 已落地(2026-09-07)· M3 收尾(验证/文档/提交)跟进中 · 日期:2026-09-07
> 上游依据:`docs/local-llm-loading-plan-2026-09.md`(本地推理已落地 N0-N3)
> 参考对象:meetily 的 `ModelSettingsModal` / `BuiltInModelManager` / `ModelDownloadProgress`(MIT)

---

## 0. 一句话总结

把设置里**平铺的 Provider 九宫格**升级为**「模型中心」双 Tab**:「本地模型」= 应用自己下载并运行的 GGUF 模型——**根据当前设备(内存/架构)自动匹配可用档位,不支持的模型直接禁用(不可下载、不可启用)**;点下载 → 进度 → 完成后点击卡片即选中。「API 模型」= 云端/自建端点(配置 API 地址 + 模型名 + API Key + 测试连接),预置名单以**千问等可在个人设备使用的开源/开放模型**为主。**任意一侧选中的模型成为全局唯一「当前使用模型」**,驱动知识抽取/出题判分/答疑与学习进度总结;`store` **本期迁移**为 `active: {source: local|api}` 复合结构。

### 0.1 已确认决策(2026-09-07 v2)

| # | 决策 | 结论 | 落点 |
| --- | --- | --- | --- |
| Q1 | 列出可下载模型时按当前设备实际匹配,**禁用不支持的模型(不可下载也不可启用)** | ✅ 采纳 | §4 设备能力匹配规则 + §7 UI 灰态卡 + Rust `llm_list_models` 返回 `supported` |
| Q2 | `store` 本期就迁移为 `active: {source: local\|api}` 复合结构(原 M3 后置 → **前置到 M0**) | ✅ 本期迁移 | §3.2 + §9 M0;localStorage v1→v2 自动迁移 |
| Q3 | API 供应商预置首屏:千问等**前 20 档可在个人设备使用的开源模型**为主,与 DeepSeek/OpenAI/自定义并列 | ✅ 采纳 | §5.2 开放模型榜单 + §7 wireframe;Anthropic/Gemini 因适配器未实现列为「规划中」禁用组 |

---

## 1. 背景与问题

### 1.1 现状(本地 LLM N0-N3 落地后)

- Rust 侧已具备:**四档 Qwen3.5 模型清单**(models.rs)、双镜像下载管理(manager.rs)、llama-helper sidecar 推理链路、`llm_*` 7 个命令 + `llm://download-progress` 进度事件。
- TS 侧已具备:`builtin` ProviderKind(默认)、`BuiltinModelsPanel`(下载/进度/取消/激活/删除)。
- 设置页形态:**Provider 九宫格**(builtin / ollama / llama.cpp / lmstudio / openai / anthropic / gemini / deepseek / custom),点 kind 后在同一卡片内换表单——本地内置模型只能以「其中一格」的形式存在,与 API 模型并列平铺。

### 1.2 体验缺口(对照 meetily)

| 体验 | meetily 做法 | 本项目现状 | 差距 |
| --- | --- | --- | --- |
| 模型分类心智 | Summary 设置里「provider 下拉」分流:本地 `builtin-ai`/`ollama` vs 云端 API | kind 九宫格平铺,builtin 与 API 混排 | 没有「本地下载」与「API 请求」两类心智 |
| 设备匹配 | (未做)——但模型卡直接带 `context_size/size_mb` 供用户自行判断 | 四档全列,不区分本机能不能跑 | **Q1:按设备内存/架构自动匹配,不支持的禁用** |
| 下载并选中 | 模型卡片:未下载→Download;下载中→进度条+Cancel;就绪→**整卡可点即选中** | 已有卡片,但「激活」是独立小按钮 | 选中语义弱,下载完不会自动引导选中 |
| 就绪模型自动使用 | 拉列表时**若无选中则自动选中首个可用模型**,下载完成即进入可用 | 下载完仅刷新列表,需手动点「激活」+「保存」 | 断点:下载完成 → 直接可用 |
| API 配置 | provider 切到云端 → 表单变 API Key(+可选自动拉取模型列表);Ollama → endpoint + 拉模型 | 云端要手填 baseUrl/model/key,无预设引导 | **Q3:预置首屏改为千问等开源模型为主** |

### 1.3 方案范围(本期)

- 重做**设置页信息架构与交互**(UI 层)+ **store 迁移(Q2)** + **少量 Rust 增强**(仅扩展 `llm_status` / `llm_list_models` 返回值,提供设备能力与每模型 `supported`,推理链路不动)。
- 引擎层零改动;`buildActiveProvider` 语义不变(仅内部读取新 store 结构)。
- 开放问题(不阻塞):API 提供商自动拉取模型列表、模型下载断点续传、本地模型多开、会话级热切换。

---

## 2. 参考:meetily 交互拆解

精读源码后,meetily 与「模型选型」相关的三块交互:

1. **`ModelSettingsModal`**(1408 行):provider 下拉(ollama / groq / claude / openai / openrouter / builtin-ai / custom-openai)。选中 provider 后表单随类型切换:
   - `builtin-ai` → 内嵌 `BuiltInModelManager`(下载/选择);
   - `ollama` → endpoint 输入(默认空=本机) + **点「拉取模型」把 endpoint 上的模型灌进下拉**;
   - 云端(openai/claude/groq/openrouter)→ 只填 API Key,填完**自动向 /models 拉取模型列表**进下拉;
   - `custom-openai` → endpoint + model + apiKey + 高级参数(maxTokens / temperature / topP)。
   - 校验:`requiresApiKey` 的 provider 无 Key 不可保存;endpoint 变更但未重拉模型时提示「endpoint 变了,需刷新模型列表」。
2. **`BuiltInModelManager`**(492 行):模型卡片流,单卡四态——未下载(Download 按钮)/ 下载中(进度条 + Cancel)/ 就绪(整卡 hover 可点 = 选中,选中后蓝色 `Selected` 徽标)/ 异常(Corrupted/Error → Retry [+ Delete])。首拉无选中时自动选首个 `available`。
3. **`ModelDownloadProgress` + toast**:下载中在 toast 显示实时百分比 / downloaded MB / speed;完成 / 取消 / 失败分别 toast,并刷新列表。

**本项目吸收点**:卡片整卡点选语义、下载完成即就绪、状态徽标体系、四态单卡、toast 级进度提示。**增强**:单卡增加第五态「设备不支持(禁用)」——参考 meetily 未做,但本项目要在多档模型 + 不同设备间防误下载,故显式灰态禁用。**不吸收**:provider 单一模态下拉(我们按「本地 / API」双 Tab 更符合产品形态)、自动拉取云端模型列表(列为开放项)。

---

## 3. 信息架构设计

### 3.1 概念模型:全局唯一「当前使用模型」

```
                        ┌──────────────────────────────────────────┐
  本地模型(下载运行) ──▶ │                                          │
  builtin: qwen3.5:4b   │   当前使用模型  (全局唯一,驱动全部 AI)     │──▶ 知识抽取
  qwen3.5:2b/0.8b/9b    │   {source: local, model}                  │──▶ 测评出题/分
   ⚠ 设备不支持 → 禁用   │   {source: api, provider, baseUrl,        │──▶ 答疑对话(规划)
                        │                model, apiKey}             │──▶ 学习进度总结(规划)
  API 模型(请求)  ─────▶ │                                          │
  qwen/deepseek/openai… │                                          │
                        └──────────────────────────────────────────┘
```

- 选中语义从「选中一个 kind」改为「在本地模型库**或** API 模型里选一个模型作为当前使用模型」。
- 设置页顶部常驻一条 **Active Banner**:`当前使用:Qwen 3.5 4B(本地 · 已就绪)` 或 `当前使用:DeepSeek-chat(API · 已连接 320ms)`,并带**设备信息 chip**(如 `本机:Apple M2 · 16GB · Metal ✓`)。

### 3.2 Store 迁移(本期,前置 M0)

现 `SavedSettings` 是扁平 key(kind/baseUrl/model/apiKey)。本期迁移为带来源的复合值,localStorage key `plos:settings:v1` → `:v2`,并做自动迁移:

```ts
type ApiProviderKind = "qwen" | "deepseek" | "openai" | "glm" | "kimi"
                    | "ollama" | "llama.cpp" | "lmstudio" | "custom"
                    | "anthropic" | "gemini"; // 后两者规划中,仅展示

type ActiveSource =
  | { source: "local"; model: string }                 // builtin 下载模型
  | { source: "api";  provider: ApiProviderKind;
                      baseUrl: string; model: string; apiKey: string };

interface SavedSettings {
  active: ActiveSource;
  providerReady: boolean;   // local=该模型 ready;api=测试通过
  testedAt?: number; lastLatencyMs?: number; savedAt?: number;
}
```

- **v1→v2 迁移**(zustand persist `migrate`):旧 `kind === "builtin"` → `{source:"local", model}`;其余 → `{source:"api", provider: kind, baseUrl, model, apiKey}`。
- `buildActiveProvider()` 内部改为读取 `active`,按 `source` 分发到 BuiltinProvider / OpenAICompatibleProvider——**对外签名与引擎调用点不变**。

### 3.3 AI 能力 → provider 方法映射(选中模型到底「处理」什么)

| 学习功能 | 入口 | 引擎 | Provider 方法 | 当前是否接 AI |
| --- | --- | --- | --- | --- |
| 导入知识抽取 | ImportModal | knowledge-engine | `extractKnowledge` | ✅(provider 构造时注入) |
| 测评生成题目 | assessment 流程 | assessment-engine | `generateAssessment` | ✅(无 provider 则本地兜底) |
| 作答评估/判分 | assessment 流程 | assessment-engine | `evaluateAnswer` | ✅(同上) |
| 答疑 / 学习进度总结 | 规划中 | — | `chat`(builtin 已打通) | ⏳ 下一里程碑 |

> 说明:引擎在**页面挂载时**用 `buildActiveProvider()` 构造一次 provider(ImportModal 用 `useMemo`),因此**切换当前模型 = 下次进入该功能即生效**;不要求会话级热切换(开放项)。

---

## 4. 设备能力匹配与模型启用规则(Q1)

### 4.1 采集哪些设备信息(数据源)

| 信息 | macOS 取值方式 | 用途 |
| --- | --- | --- |
| 物理内存 RAM | `sysctl hw.memsize` | 判定可运行档位 |
| CPU 架构 | `uname -m`(arm64 / x86_64) | 判定 sidecar 二进制是否匹配 |
| OS | `std::env::consts::OS` | 本地 sidecar 仅随 mac 包分发 |
| Metal 可用 | 构建期 feature(mac arm64 恒真) | 标记加速状态(展示用) |

> 仅在 Rust 侧计算(单点真源),前端只负责渲染。纯浏览器(web 预览)拿不到设备信息 → 本地 Tab 一律提示「需桌面端」并禁用下载。

### 4.2 单档模型的内存要求与禁用阈值

> 口径 = 模型常驻(权重 + KV cache)+ 应用自身 + 系统留白后的**设备最小内存**;Q4_K_M 量化。

| 档位 | 常驻估算 | 设备 RAM 建议 | **禁用线(min_ram)** | 说明 |
| --- | --- | --- | --- | --- |
| 0.8B | ~2 GB | 8 GB | ≥ 4 GB | 最低配兜底 |
| 2B | ~3-4 GB | 8 GB | ≥ 8 GB | 轻量档 |
| 4B(默认) | ~4-6 GB | 16 GB | ≥ 12 GB | 8 GB 机型禁用,12-14 GB 可跑但提示内存紧张 |
| 9B | ~7-10 GB | 24 GB+ | ≥ 20 GB | **16 GB 机型禁用**(本机即此例) |

### 4.3 匹配规则(判定逻辑)

```
support(model) =
  架构不在 {macOS + arm64}            → 否("本地模型需 macOS Apple Silicon 桌面端")
  RAM < model.min_ram                 → 否("本机 {ram}GB 不足以流畅运行,需 ≥{min_ram}GB")
  否则                                → 是
```

**默认推荐也随设备调整**:RAM ≥ 16 GB → 推荐 4B(默认);8-12 GB → 推荐 2B;低配 → 0.8B。
**示例(本机 Apple M2 / 16GB)**:0.8B / 2B / 4B ✅ 可用(默认推 4B);9B ❌ **禁用**(灰态卡,不可下载、不可点选,附原因「需 ≥20GB 内存」)。
**示例(8GB 机型)**:仅 0.8B / 2B ✅;4B 与 9B 均禁用。

### 4.4 Rust 返回值扩展(唯一后端改动)

```jsonc
// llm_status 扩展
{ "helper_ready": true,
  "default_model": "qwen3.5:4b",
  "device": { "os": "macos", "arch": "aarch64", "ram_gb": 16, "metal": true } }

// llm_list_models 每项扩展(manager 扫描后按 §4.3 计算)
{ "name": "qwen3.5:9b", "display_name": "Qwen 3.5 9B(高质量档)", "status": "not_found",
  "supported": { "ok": false, "reason": "device_ram_min20" },
  … }
```

前端规则:`!supported.ok` 的卡 → 灰显 + 禁用角标 + 不可下载/不可启用;`reason` 直接映射为卡内说明文案。

---

## 5. 可下载 / 可请求的模型

### 5.1 本地可下载模型清单(数据源 = Rust `models.rs`)

> 状态:not_found(未下载)/ downloading / ready(已就绪可选中)/ corrupted(异常)。
> **兼容列**来自 §4 设备匹配——`⛔` 表示本机禁用(不可下载、不可启用)。

| 名称 | 展示名 | 文件(约) | 内存 | context | 下载源(按序) | 本机(16GB) | 定位 / 建议 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `qwen3.5:4b` | Qwen 3.5 4B(默认档) | 2.5 GB | 4-6 GB | 32768 | 魔搭 → HF | ✅ 推荐 | 16GB Mac 流畅,出题/评估质量稳 |
| `qwen3.5:2b` | Qwen 3.5 2B(轻量档) | 1.3 GB | 3-4 GB | 32768 | 魔搭 → HF | ✅ | 弱网 / 后台常驻轻盈 |
| `qwen3.5:0.8b` | Qwen 3.5 0.8B(超轻量) | 0.65 GB | ~2 GB | 32768 | 魔搭 → HF | ✅ | 最低配 / 快速冒烟 |
| `qwen3.5:9b` | Qwen 3.5 9B(高质量档) | 5.5 GB | 7-10 GB | 32768 | 魔搭 → HF | ⛔ 需 ≥20GB | 高配机器才展示可下载 |

> 推荐策略:新用户首次进「模型中心」→ 引导下载**设备推荐档**(本机=4B);弱网一键切 2B/0.8B;被禁用的档位不出现下载按钮。

### 5.2 API 预置模型:开源/开放模型 Top 榜(Q3)

「前 20 档个人设备可用的开源模型」过滤口径:**开放权重(可本地跑) + 有 OpenAI 兼容云 API(个人可直接请求)**。从中挑出预置首屏名单:

| 排名 | 开源模型 | 是否可本地跑(个人设备) | OpenAI 兼容云 API | 预置首屏 |
| --- | --- | --- | --- | --- |
| 1 | **Qwen 千问**(阿里) | ✅(本项目本地默认同族) | 阿里云百炼 DashScope | ⭐ 默认示例 |
| 2 | **DeepSeek**(深度求索) | ✅ | api.deepseek.com | ✅ |
| 3 | **GLM**(智谱) | ✅ | open.bigmodel.cn | ✅ |
| 4 | **Kimi / Moonlight**(月之暗面,开放部分) | 部分 | api.moonshot.cn | ✅ |
| — | Llama / Mistral / Phi / Gemma / Yi / Baichuan / MiniCPM / InternLM 等 | 可,但中文与生态权衡后非首选 | 有(经各自/中转) | 不占首屏,可走「自定义兼容」 |
| — | OpenAI / Anthropic / Gemini(闭源) | ❌ | 有 | OpenAI ✅;Anthropic/Gemini ⏳ 适配器未实现 → 禁用组 |

**首屏预置卡(最终)**:千问 · DeepSeek · OpenAI · 智谱 GLM · Kimi · 自定义兼容(OpenAI 协议)。
**规划中禁用组**:Anthropic / Gemini(registry `DEFERRED`,点到提示「传输格式适配器未实现」)。
**本地服务分组**:Ollama · llama.cpp · LM Studio(外部自跑端点,免 Key)。

| 预置 | 默认 Base URL(OpenAI 兼容) | 默认模型(可改) |
| --- | --- | --- |
| 千问 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.5` |
| Kimi(月之暗面) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 自定义兼容 | 空,用户填 | 空 |

> 默认模型为**建议值**,可自由改写;`openai-compatible.ts` 的 `normalizeOpenAiBaseUrl` / `defaultModelOf` 增补 qwen/glm/kimi 三个分支(anthropic/gemini 仍走 DEFERRED,不在此实现)。

---

## 6. 交互流程

### F0 进入模型中心 → 设备匹配与禁用(Q1)

1. 首次进入,前端调 `llm_status` + `llm_list_models`。
2. 每张本地卡按 `supported.ok` 渲染:**不支持的卡整卡灰态**,无下载按钮、不可点选,卡内一行小字原因(如「本机 16GB,运行 9B 需 ≥20GB」)。
3. 顶部设备 chip:`本机:Apple M2 · 16GB · Metal ✓`。
4. 若纯浏览器:整段提示需桌面端;若架构非 mac arm64:本地 Tab 顶部黄条「本地模型需 macOS Apple Silicon」。

### F1 浏览可下载模型 → 点击下载

1. 可用卡按推荐序排:设备推荐档(本机=4B)首位带「推荐」角标。
2. 未下载卡:`[下载]`;点击后按钮区变进度条(百分比 + 已下载/总量 + 网速)+ `[取消]`。
3. 下载在**后台**进行(离开设置页不中断,右上角 toast 进度);双源失败自动切换,单卡错误原因 + `[重试]`。
4. 完成 → 全应用 toast「Qwen 3.5 4B 下载完成」→ 卡片转「已就绪」。

### F2 下载完成后点击选中 → 处理学习任务

1. 已就绪卡**整卡可点**,点击后描边高亮 + 蓝色 `当前使用` 徽标 → **立即写库生效**(免再保存)。
2. Active Banner 同步刷新;侧边栏「设置」绿点亮起(providerReady=true)。
3. 之后导入抽取、测评出题判分全部走该模型;无网络完全可用。
4. 首次进入且无就绪模型:空态引导「下载设备推荐模型 4B(约 2.5 GB)开始本地学习」+「改用 2B」+「仅配置 API 模型」旁路。

### F3 切换 / 删除本地模型

- 切换:点另一张就绪卡即切换。删除正在使用的模型:confirm 提示「将回退到启发式引擎」,删除后 Banner 转「未配置」、绿点熄灭。
- 删除仅删文件,可重下;列表重扫刷新。

### F4 配置 API 模型(API 地址 + 模型 + API Key)

1. 切「API 模型」Tab。
2. 预置卡按 §5.2:点「千问」即带入 DashScope 默认端点与 `qwen-plus`;DeepSeek/OpenAI/GLM/Kimi 同。
3. 表单三字段:`Base URL`(可改)、`模型`、`API Key`(密码框,云端必填;自定义可留空)。
4. `[测试连接]`:最小 chat 请求,成功 `✅ 已连接 · 320ms`;失败给「原因 + 怎么改」两句式。
5. `[使用该模型]`:写库点亮 Banner/绿点。API Key 明文存本机 localStorage(现状,表单下提示)。

---

## 7. 设置页 UI Wireframe

> 基调沿用现有 indigo 细线 + 卡片体系;关键帧示意(非像素稿)。

### 7.1 模型中心总览(Active Banner + 设备 chip + 双 Tab)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  设置 · AI 模型中心                                   [帮助:如何选模型 ▾]   │
│  选择一个模型作为「当前使用」,知识抽取 / 测评 / 答疑与进度总结都由它完成        │
├────────────────────────────────────────────────────────────────────────────┤
│  ● 当前使用:Qwen 3.5 4B(本地 · 已就绪)         [本机:Apple M2 · 16GB · Metal ✓]│
│  ⚪ 数据完全在本地 · 离线可用 · 设备推荐档        [打开模型目录] [更换 ▾]      │
├───────────────────────────────┬────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────┐  │  (内容区见 7.2 / 7.4)                       │
│  │◼ 本地模型   │ │ API 模型│  │                                            │
│  └─────────────┘ └─────────┘  │                                            │
└───────────────────────────────┴────────────────────────────────────────────┘
```

### 7.2 本地模型 Tab(含禁用灰态卡)

```
Tab:本地模型                                   下载存至:本机数据目录 models/llm
    · 下载源:ModelScope 优先 → HuggingFace 兜底   · 已按本机(16GB)匹配,禁用档不提供下载

┌────────────────────────────────────────────────────────────────────────────┐
│  Qwen 3.5 4B (默认档)                          ⭐设备推荐 · ●已就绪 · 蓝[当前使用]│
│  Qwen3.5-4B-Q4_K_M.gguf · 约 2.5 GB · 32768 ctx · 中文讲解/出题/评估/计划    │
│  ════════════════════════════════════════════════════════════════════════   │
│  (整卡可点=切换使用;hover 边框加深)                       [🗑 删除]          │
├────────────────────────────────────────────────────────────────────────────┤
│  Qwen 3.5 2B (轻量档)                                    ●已就绪             │
│  约 1.3 GB · 32768 ctx · 弱网/后台常驻轻盈                   (整卡可点)       │
├────────────────────────────────────────────────────────────────────────────┤
│  Qwen 3.5 0.8B (超轻量)                                  ○未下载  [下载]     │
│  约 0.65 GB · 最低配机器 / 快速冒烟验证                                       │
├────────────────────────────────────────────────────────────────────────────┤
│  Qwen 3.5 9B (高质量档)                     灰显 ⚠ 设备不支持 · 不可下载/启用  │
│  约 5.5 GB · 需内存充裕 · 运行需 ≥20GB 内存(本机 16GB)      [无按钮 · 不可点] │
└────────────────────────────────────────────────────────────────────────────┘
```

状态/态徽标规范(与 Rust 状态一一对应):

| 状态 | 徽标 | 可操作 |
| --- | --- | --- |
| `ready` | 绿点 + 已就绪;选中加蓝「当前使用」 | 整卡点选;非当前使用的卡可🗑删除 |
| `not_found` | 灰 ○ 未下载 | `[下载]` |
| `downloading` | 靛蓝 ◐ 下载中(进度条) | `[取消]` |
| `corrupted` | 红 ⚠ 文件异常 + 原因 | `[重试]` `[删除]` |
| `!supported.ok` | 灰态整卡 + ⚠ 设备不支持 + 原因 | **无任何按钮(禁下载/禁启用)** |

### 7.3 下载 toast(离开设置页也可见)

```
┌──────────────────────────────────────────┐   ┌──────────────────────────────┐
│  ⬇ Qwen 3.5 9B 正在下载 62%               │   │  ✅ Qwen 3.5 4B 下载完成      │
│  1.5 / 2.5 GB · 18 MB/s        [取消]     │   │  [去选中]  点击卡片即切换使用 │
└──────────────────────────────────────────┘   └──────────────────────────────┘
```

### 7.4 API 模型 Tab(开源模型预置为主)

```
Tab:API 模型                    API Key 明文存本机 localStorage(仅本应用调用)

┌─ 预置供应商(OpenAI 兼容协议 · 开源模型为主)──────────────────────────────┐
│ [▣ 千问 Qwen] [□ DeepSeek] [□ OpenAI] [□ 智谱 GLM] [□ Kimi] [□ 自定义] │
└──────────────────────────────────────────────────────────────────────────┘

┌─ 配置(以 千问 Qwen 为例,默认示例)───────────────────────────────────────┐
│  Base URL   https://dashscope.aliyuncs.com/compatible-mode/v1 (可改)    │
│  模型        qwen-plus        (建议值,可改)                              │
│  API Key    ••••••••••••••   (必填)                                     │
│                                 [测试连接]  [使用该模型]                 │
└─────────────────────────────────────────────────────────────────────────┘
  测试成功: ✅ 已连接 · 320ms · 模型在线
  测试失败: ❌ 401 → 检查 API Key / 账户额度

┌─ 规划中(适配器未实现 · 禁用)────────────────────────────────────────────┐
│ [□ Anthropic(灰)] 非 OpenAI 传输格式,待适配器里程碑   [□ Gemini(灰)]   │
└──────────────────────────────────────────────────────────────────────────┘
┌─ 本地服务(自建端点,免 Key · 归端点型)──────────────────────────────────┐
│ [□ Ollama  http://localhost:11434/v1 · llama3.1]                       │
│ [□ llama.cpp …8080/v1]  [□ LM Studio …1234/v1]                         │
└──────────────────────────────────────────────────────────────────────────┘
```

校验:云端 provider 无 Key 不可「使用」;Base URL 需 http(s)://;「使用」前建议先测试(不强制)——与现状一致。

### 7.5 空态与降级

| 场景 | 展示 |
| --- | --- |
| 从未配置任何模型 | Banner「未配置 — 学习功能以离线启发式运行」;本地 Tab 大引导卡 `[下载设备推荐 4B]` `[改用 2B]` + 「或 [配置 API 模型]」 |
| 本机无任何可用本地档(如 8GB 以下全禁 / 非 mac arm64) | 本地 Tab 顶部黄条说明 + 直接引导 API Tab |
| 纯浏览器(web 预览) | 本地 Tab 禁用并提示桌面端;API Tab 可正常配置/测试 |
| 正在使用的本地模型被删除 | confirm → 回退启发式;Banner「未配置」 |

### 7.6 组件树(建议)

```
src/features/settings/
├── ModelCenterPage.tsx(或并入 SettingsPage)
│   ├── ActiveBanner.tsx            // 当前使用 + 设备 chip + 更换
│   ├── ModelTabs.tsx               // 本地 / API 双 Tab 头
│   ├── LocalModelsTab.tsx          // ← 重构 BuiltinModelsPanel
│   │   └── LocalModelCard.tsx      // 五态单卡(下载/进度/选中/异常/设备禁用)
│   └── ApiModelsTab.tsx
│       ├── ApiProviderPresets.tsx  // 千问/DeepSeek/OpenAI/GLM/Kimi/自定义 + 禁用组
│       ├── ApiConfigForm.tsx       // baseUrl/model/apiKey/测试
│       └── LocalEndpointGroup.tsx  // ollama/llama.cpp/lmstudio 归组
└── hooks/useModelHub.ts            // llm_status+llm_list_models+进度订阅+动作 聚合
```

---

## 8. Tauri 如何「安装并运行」本地模型(机制说明)

### 8.1 安装包结构:sidecar 随包,模型不进包

```
Personal Learning OS.app/
└── Contents/
    ├── MacOS/personal-learning-os          ← 主程序(Tauri shell)
    ├── …/llama-helper-aarch64-apple-darwin ← externalBin 打包的 sidecar(llama.cpp 推理进程)
    └── Resources/                          ← 前端 dist + 图标(模型 GGUF 不在其中)
```

- `tauri.conf.json` `bundle.externalBin` 声明 `binaries/llama-helper-aarch64-apple-darwin`,`tauri build` 自动放进 .app;Rust `sidecar.rs` 运行时解析并 spawn。
- **GGUF 模型不随安装包分发**(否则安装包 2.5 GB+),首次使用时**按需下载**。

### 8.2 运行时「安装」= 下载到应用数据目录

1. 用户点「下载」→ Rust `llm_download` → `manager.rs` 按 `ModelDef.mirrors` 顺序下载(**魔搭主,失败自动切 HF**),带进度、可取消、`approx_bytes` 完整性下限校验。
2. 落盘:`~/Library/Application Support/<bundle-id>/models/llm/`(见 models.rs `get_models_directory`)。
3. 下载完成即文件就位 → `llm_list_models` 重扫标记 `ready` → 卡片转「已就绪,可点选」。
4. 设备匹配在**同一命令里计算**(§4.4):文件存在但设备不支持也照常展示禁用(文件可留作迁移后使用,或删除释放空间)。

### 8.3 推理进程托管(sidecar 生命周期)

- 点选就绪模型后,首次请求时 `sidecar.rs` spawn helper(空转 300s 自动回收,再请求冷启拉起;模型常驻内存缓存避免重复加载)。
- 协议 **JSON over stdin/stdout**:TS → `llm_generate` → helper 加载 GGUF → Metal(仅 mac arm64,构建期 feature)→ 回吐 → TS `{content}` 交引擎。
- 全在本机:离线可用,数据不出设备。

### 8.4 删除 / 清理

`llm_delete` 删 GGUF 文件;卸载应用后数据目录一并清除。

### 8.5 应用体积与首启影响

| 项 | 影响 |
| --- | --- |
| 安装包体积 | 不因模型增大 |
| 首次使用路径 | 下载 4B ≈ 2.5 GB(后台可离开页面,可取消/降档) |
| 常驻内存 | 4B ≈4-6 GB;空闲 300s 自动卸载 |

---

## 9. 实现里程碑

> 已落地 N0-N3 全部复用;本方案 = 信息架构/交互 + store 迁移(Q2)+ 设备匹配(Q1)+ API 预置名单(Q3)。

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M0 store 迁移(v2)+ 骨架** | SavedSettings → `active: ActiveSource`,persist `:v1→:v2` 迁移;SettingsPage / BuiltinModelsPanel / buildActiveProvider 适配;ModelCenterPage 双 Tab + ActiveBanner(含设备 chip) | 旧配置升级行为一致;typecheck/build 绿 |
| **M1 设备匹配 + 本地交互闭环** | Rust:`llm_status` 增 device、`llm_list_models` 每项增 supported(§4.4);TS `LocalModelCard` 五态(含设备禁用灰态);F0-F3 全流程 | tauri dev:列表按本机匹配(16GB 禁 9B);下载 0.8B → 点选 → Banner/绿点 → 测评走本地 |
| **M2 API Tab(Q3)** | `ApiProviderPresets`(千问/DeepSeek/OpenAI/GLM/Kimi/自定义 + Anthropic/Gemini 禁用组 + ollama/llama.cpp/lmstudio 分组);`openai-compatible.ts` 增 qwen/glm/kimi 预置;表单/测试/使用 | 千问预设一键带 DashScope 端点;测试两句式;「使用」后引擎走该端点 |
| **M3 收尾** | 全链路验证 + README/方案状态回填 + commit | cargo test / typecheck / build 绿;端到端本地+API 各跑通一次 |

**不改的东西**:`buildActiveProvider()` 对外签名、引擎注入点、Rust 推理链路与 `llm_generate` 等命令面(M1 仅扩展两个查询命令的返回值);引擎构造时机不变(页面挂载),切模型下次进入生效。

---

## 10. 风险与开放问题

| 级别 | 风险/开放项 | 影响 | 缓解 / 建议 |
| --- | --- | --- | --- |
| P0 | 下载中断/弱网(4B 2.5GB) | 首次体验差 | 后台下载 + 取消 + 双源;空态给 2B/0.8B 降档与「仅 API」旁路 |
| P0 | 设备阈值拍脑袋导致「能跑的被禁 / 跑不动的被放行」 | 误禁/卡死 | 阈值集中 Rust 一处(§4.2),按 Q4 量化 + 32K ctx 保守估算;上真机(8/16/24GB)冒烟校准 |
| P1 | 正在使用的本地模型被删 / 换 API | 引擎静默回退 | confirm + Banner 状态同步;回退即启发式(engine 已天然降级) |
| P2 | 下载状态跨重启不持久(部分文件) | 需重下 | 开放项:断点续传(manager 记 .part) |
| P2 | API 模型名靠手填易错 | 配置摩擦 | 开放项:预置云端拉 `/models`(meetily 已做,可借鉴) |
| P2 | 云端 Key 明文 localStorage | 安全隐患(现状) | 保持现状并显式提示;可选 tauri-plugin-keyring |
| P2 | Anthropic / Gemini 只能禁用展示 | 用户不可用 | 属既有 DEFERRED 里程碑,本期只标注「规划中」不实现 |

---

## 11. 附录

### 11.1 meetily ↔ 本项目对照表

| meetily | 本项目吸收 | 差异原因 |
| --- | --- | --- |
| `ModelSettingsModal` provider 模态下拉 | 双 Tab(本地/API) | 产品形态:「两类模型」心智而非「一家供应商」 |
| `BuiltInModelManager` 卡片四态 + 整卡点选 + Selected 徽标 | 1:1 吸收 + **增设备禁用灰态(第五态)** | meetily 无设备匹配;本项目需防多档误下载 |
| 下载进度 toast + 完成/取消 toast | 吸收(完成 toast 带「去选中」) | 一致 |
| 云端填 Key 后自动拉模型列表 | 列为 P2 开放项 | 需每厂商 /models 适配,先不阻塞主线 |
| `builtin-ai` 与 `ollama` 并列 provider 下拉 | `ollama` 等归 API Tab「本地服务」分组 | 明确「应用自管」vs「外部自建端点」边界 |

### 11.2 千问等开源模型 API 预置字段速查(Q3 依据)

| provider kind | 默认 Base URL | 默认 model | 是否本期实现 |
| --- | --- | --- | --- |
| qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | ✅(OpenAI 兼容) |
| deepseek | `https://api.deepseek.com/v1` | `deepseek-chat` | ✅(已有) |
| openai | `https://api.openai.com/v1` | `gpt-4o-mini` | ✅(已有) |
| glm | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.5` | ✅(新增) |
| kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` | ✅(新增) |
| custom | 空 | 空 | ✅ |
| anthropic / gemini | — | — | ⏳ DEFERRED(禁用展示) |
| ollama / llama.cpp / lmstudio | 本机默认端口 | llama3.1 等 | ✅(归本地服务分组) |

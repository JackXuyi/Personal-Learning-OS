# Personal Learning OS 本地模型加载方案(参考 meetily)

> 目标:参考 [Zackriya-Solutions/meetily](https://github.com/Zackriya-Solutions/meetily) 的本地模型加载机制,在本项目实现"应用内置、开箱即用"的本地 LLM——用户不再需要自己安装 Ollama / llama.cpp / 手动下载模型。
>
> 状态:已落地 N0–N3(2026-09-07)——llama-helper 推理链路、内置模型管理、builtin Provider 与设置 UI 均已实现并通过中文推理冒烟;N4 打磨待续 · 方案定稿 v2

---

## 0. 结论摘要

- **参考对象**:meetily 的 `llama-helper`(进程内推理 sidecar)+ `ModelDef 声明式模型清单` + `模型管理器`三件套,是"应用自己把开源模型加载起来"的最小可靠范式,建议**同构移植**。
- **现状差距**:本项目 AI 层已为 `ollama / llama.cpp / lmstudio` 预留 OpenAI 兼容 HTTP 适配,但**模型加载依赖用户手动装服务**——不是"本地模型加载",只是"本地服务连接"。要达成 meetily 的 local-first 闭环,需新增 Rust 侧推理进程 + 模型下载管理 + TS Provider。
- **选型结论**:以 **Qwen3.5-4B(Q4_K_M,~2.5GB,Unsloth Dynamic GGUF)为默认档**(中文强、16GB Mac 流畅,meetily 高质档同款);**2B(~1.2GB)作为轻量备选**(低配机器/后台常驻轻量场景),0.8B / 9B 作为低配与高质两档扩展;下载源主 **ModelScope(魔搭)**、备 **HuggingFace**。
- **落地形态**:新增 `src-tauri/llama-helper` 独立 crate(llama-cpp-2 进程内推理、Metal 加速、模型常驻缓存、JSON over stdio),Tauri 命令面暴露模型管理 + 生成,TS 侧新增 `builtin` ProviderKind 并**设为默认**,现有 engine 零改动接入。
- **不做什么**:不做 ASR / 语音类模型(meetily 的 Whisper/Parakeet 与本项目无关);多模态(mmproj)与流式输出列为后续里程碑。

### 0.1 已确认决策(2026-09-07)

| # | 决策项 | 结论 |
| --- | --- | --- |
| Q1 | `builtin`(内置本地模型)设为默认 Provider | ✅ 是(云端/外部服务保留在设置中可切换) |
| Q2 | 默认模型档位 | ✅ **Qwen3.5-4B** 为默认;2B 作为轻量备选一并预置 |
| Q3 | 下载双源 | ✅ ModelScope(魔搭)主 + HuggingFace 备,失败自动切换 |
| Q4 | Metal GPU 加速(仅 mac arm64) | ✅ 本期启用 |
| Q5 | scope | ✅ 仅 LLM 文本推理,不做语音类 |

---

## 1. 背景与现状分析

### 1.1 产品定位

本项目是 **local-first 的 AI 学习系统**:知识入库 → 自适应学习循环(讲解 / 出题 / 作答评估)。"不出本机"是核心承诺,与 meetily"100% local processing"同一价值主张。这意味着 LLM 能力最终必须能**完全离线**运行,而不只是"能连云端 API"。

### 1.2 当前 AI 层结构(已具备)

| 文件 | 现状 |
| --- | --- |
| `src/ai/types.ts` | `ProviderKind` 已含 `ollama / llama.cpp / lmstudio / openai / deepseek / anthropic / gemini / custom`;`AIProvider` 接口已定(`chat` / `extractKnowledge` / `generateAssessment` / `evaluateAnswer`) |
| `src/ai/openai-compatible.ts` | 通用 HTTP 适配,本地家族默认端点:`ollama:11434`、`llama.cpp:8080`、`lmstudio:1234` |
| `src/ai/registry.ts` | 按 kind 构造 Provider;anthropic / gemini 暂未实现 |
| `src/stores/useSettingsStore.ts` | UI 上选择 kind / baseUrl / model / apiKey |
| `src-tauri/src/lib.rs` | 仅 `app_status` 一个命令("foundation-scaffold") |

### 1.3 Gap:三种"本地模型"的差别

| 形态 | 谁负责加载模型 | 用户体验 | 本项目现状 |
| --- | --- | --- | --- |
| A. 外部本地服务(现状) | 用户自己装 Ollama/llama.cpp,手动 pull/下载模型 | 门槛高、易踩版本坑 | ✅ 已支持(HTTP 适配),但无加载能力 |
| B. 自动托管服务 | 应用检测并引导安装 Ollama、代跑 `ollama pull` | 仍需第三方常驻程序;Ollama 尚不支持 Qwen3.5 GGUF | ❌ |
| C. 内置推理进程(meetily) | 应用内 spawn 推理子进程,自带模型下载/缓存/卸载 | 开箱即用、零外部依赖 | ❌ 本次目标 |

> 结论:本项目当前停留在形态 A。要做的是升级到 **形态 C(meetily 路线)**,同时保留形态 A / 云端 API 作为 Provider 备选——接口已经允许。

---

## 2. meetily 本地模型加载机制拆解(参考基准)

以下机制来自 meetily 源码,是我们要"对应实现"的蓝图:

| # | 机制 | meetily 实现 | 关键点 |
| --- | --- | --- | --- |
| M1 | **进程内推理 sidecar** | `llama-helper/` 独立 Rust crate,依赖 `llama-cpp-2 =0.1.146`,features: `metal / cuda / vulkan` | 模型由**应用自己的进程**加载,不依赖任何外部服务 |
| M2 | **极简 IPC 协议** | JSON over stdin/stdout(每行一条):`generate / ping / shutdown` 请求;`response / pong / goodbye / error` 响应 | 无 HTTP 端口占用、无鉴权问题;单次 `generate` 同步返回整段文本 |
| M3 | **模型常驻缓存** | `ModelState`:已加载的 `model_path` + `context_size`,`load_model_if_needed` 仅在两者变化时重载 | 首请求加载,后续请求零加载开销;空闲 300s(`LLAMA_IDLE_TIMEOUT`)自动退出 |
| M4 | **GPU 自动卸载层数** | Metal 用 `sysctl hw.memsize × 0.6` 估显存;CUDA 用 `nvidia-smi`;按模型文件大小/层数/上下文算出 `n_gpu_layers` | 无 GPU 时保守回退;Apple Silicon 自动吃到 Metal |
| M5 | **声明式模型清单** | `models.rs::get_available_models()` → `ModelDef{ name, display_name, gguf_file, template, download_url, size_mb, context_size, layer_count, sampling, description }` | 加模型 = 加一条声明;系统自动 scan/download/list |
| M6 | **模型生命周期管理** | `model_manager.rs`:scan 磁盘状态(`NotFound/Downloading/Ready/Corrupted`)、带进度(百分比+MB/s)下载、校验文件大小、防并发下载、可取消 | 模型存应用数据目录 `models/summary/`,**不进安装包**,首次使用按需下载 |
| M7 | **提示词模板按模型定制** | `format_prompt(template, system, user)`,如 `qwen3.5_nonthinking`(ChatML + 空 think 块开场)、`gemma3`;对用户输入做控制标记转义(防注入) | 不做通用 chat 解析,模板与 stop token 随 ModelDef 声明 |
| M8 | **sidecar 托管与打包** | `sidecar.rs::SidecarManager` spawn 子进程(stdin/stdout pipe)、健康检查(ping)、空闲回收;`tauri.conf bundle.externalBin: ["binaries/llama-helper"]` | 生产包随应用分发 helper 二进制;开发模式走编译产物 |

---

## 3. 开源模型选型(适配本项目任务)

### 3.1 任务画像

本项目的 AI 任务(讲解、出题、评估、计划生成)特点:**中文为主**、需要**指令跟随与一定推理**、输出常需**结构化(JSON)**,单次输出 200~1500 token,无长文档强需求。

### 3.2 选型矩阵(本机:Apple Silicon / 16GB / macOS 15.7)

meetily 已在生产验证 **Qwen3.5 走 llama.cpp 的完整链路**(且官方确认 Qwen3.5 GGUF 因 mmproj 分离暂不被 Ollama 支持,必须 llama.cpp 系后端——与我们的 sidecar 路线天然一致),因此主推 Qwen3.5,而非再引入 Gemma / Llama 增加适配面。

| 档位 | 模型(GGUF) | 文件大小 | 运行内存 | 定位 | 建议 |
| --- | --- | --- | --- | --- | --- |
| L0 超轻量 | Qwen3.5-0.8B-Q4_K_M | ~0.7 GB | ~2 GB | 低配机器/纯浏览 | 可选 |
| L1 轻量备选 | Qwen3.5-2B-Q4_K_M | ~1.2 GB | ~3.5 GB | 后台常驻轻盈 / 低配机器 | **一并预置** |
| **L2 默认(已定)** | **Qwen3.5-4B-Q4_K_M** | ~2.5 GB | ~5.5 GB | 讲解/出题/评估/计划推理 | **默认随附,激活默认档** |
| L3 旗舰可选 | Qwen3.5-9B-Q4_K_M | ~5.5 GB | ~7-10 GB | 需要最高本地质量时 | 可选,按用户内存提示 |

- **为什么是 Qwen**:开源中文能力第一梯队;Apache-2.0 无商用限制;Unsloth Dynamic 2.0 量化质量好;与 meetily 已锁定的 `llama-cpp-2 =0.1.146` 完全兼容。
- **为什么默认 4B 而不是 2B**:本机 16GB Apple Silicon 运行 4B Q4(~2.5GB 权重 + KV cache ≈ 4~6GB 常驻)完全流畅;4B 在出题/评估等需要推理的任务上质量显著高于 2B——而这是学习系统的核心价值场景。2B 仍预置,供"后台常驻极致轻量 / 更低配机器"切换。
- **为什么不是 Gemma3 / Llama3.1**:当前 TS 默认模型写着 `llama3.1`,仅作为 Ollama 演示默认值,无历史包袱;Gemma3 中文弱于 Qwen;没必要引入第二套模板(新增模板面 = 维护成本)。Gemma 可作 L4 预留。
- **下载源(国内关键)**:主 **ModelScope 魔搭**(unsloth 官方镜像,直连快),备 **HuggingFace**(meetily 原 URL)。两源 URL 均写进 `ModelDef`,下载失败自动切换。

### 3.3 采样与模板基调(按学习任务)

| 任务 | 建议预设 | 说明 |
| --- | --- | --- |
| 讲解 / 问答 | 类 `qwen35_summary`(temp 0.5、top_p 0.8、presence 0.3) | 适度温度,避免重复 |
| 出题 / 评估 / JSON 输出 | 类 `tight_structured`(temp 0.1、top_k 20) | 近贪心,提升 schema 稳定;可配 stop=`<|im_end|>` |
| 提示词模板 | `qwen3.5_nonthinking`(ChatML,空 think 块开场 + 输入控制标记转义) | meetily 已验证,中文 JSON 场景直接复用 |

> 说明:Qwen3.5 Small 系列默认关闭 thinking(reasoning),正好符合我们"要快、要结构化"的诉求;空 think 块开场是 meetily 防止模型误入思考模式的工程技巧,保留。

---

## 4. 目标架构

```mermaid
graph TD
    subgraph TS 前端 React
        E[Engine 各学习引擎] --> P[AIProvider 接口]
        P --> B[builtin Provider<br/>新增 kind="builtin"]
        P --> O[OpenAICompatible<br/>ollama/llmstudio/deepseek...]
        B -->|tauri invoke| C
    end
    subgraph Rust src-tauri
        C[llm commands<br/>list/download/delete/generate]
        C --> M[llm/manager.rs<br/>模型生命周期·下载进度]
        C --> H[llm/sidecar.rs<br/>spawn/健康检查/空闲回收]
        M --> D[模型目录<br/>app_data_dir/models/llm]
        H -->|JSON over stdio| L
    end
    subgraph llama-helper 独立 crate
        L[main.rs<br/>generate/ping/shutdown]
        L --> LC[llama-cpp-2<br/>Metal GPU offload]
        LC --> GG[(Qwen3.5 GGUF)]
    end
    D -.按需下载 ModelScope/HF.-> GG
```

**关键交互**(生成一次回答):
1. TS `builtin.chat(messages)` → `invoke("llm_generate", {model, messages, params})`;
2. Rust 查 ModelDef → 取模板与采样 → `format_prompt` 拼 prompt → 确保 helper 已 spawn;
3. `sidecar.send_request(generate)` 写入 stdin,读回整段文本 → 返回 TS;
4. 模型未下载 → 返回明确错误,TS 转引导下载;下载完成前不入推理。

---

## 5. 落地设计(meetily 映射)

### 5.1 Cargo 工程结构调整

```
src-tauri/
├── Cargo.toml            # 改为 [workspace] 根,members = [".", "llama-helper"]
├── llama-helper/         # 新增独立 crate(参考 meetily 同构移植)
│   ├── Cargo.toml        # llama-cpp-2 =0.1.146;features: metal/cuda/vulkan
│   └── src/main.rs       # IPC 协议 + ModelState + VRAM 检测 + generate
├── src/
│   ├── llm/              # 新增模块(主应用侧)
│   │   ├── mod.rs
│   │   ├── models.rs     # ModelDef 清单(§3.2 四档)+ template + sampling 预设
│   │   ├── manager.rs    # scan/list/download(进度事件)/delete/取消
│   │   └── sidecar.rs    # helper 二进制解析 + spawn + 健康/空闲循环 + send_request
│   └── lib.rs            # 注册 llm commands
└── binaries/             # 打包约定:llama-helper(externalBin, 构建期按 target-triple 改名)
```

### 5.2 llama-helper crate 要点(移植清单)

- 依赖锁 **`llama-cpp-2 = "=0.1.146"`**(meetily 锁定版,避免上游 API 漂移)。
- 协议逐条对齐 meetily:请求 `{"type":"generate", prompt, max_tokens, context_size, model_path, temperature, top_k, top_p, presence_penalty, frequency_penalty, repeat_penalty, penalty_last_n, stop_tokens}`;`ping`;`shutdown`;响应 `response{text}/pong/goodbye/error`,**每行一个 JSON**。
- `ModelState::load_model_if_needed`:model_path 与 context_size 都未变 → 不重载(常驻)。
- `detect_vram_gb` + `calculate_gpu_layers`:Metal(`sysctl hw.memsize`×0.6)/ CUDA(`nvidia-smi`),按文件大小、层数、上下文保守卸载;失败回退 4GB 估算。
- 采样参数做 `finite/range` 清理(meetily `SamplingConfig::from_request` 原样),`temperature=0` 走贪心。
- macOS arm64 构建启用 `metal` feature(本机 16GB 统一内存,收益明显);Windows/Linux 预留 cuda/vulkan,本期不编。
- 单元测试保留 meetily 的模板转义 / 参数清理用例,作为移植正确性回归。

### 5.3 Rust 主应用侧

**`llm/models.rs`**:ModelDef 清单(**默认档 Qwen3.5-4B 排首位**,其次 2B/0.8B/9B),每档含 name(`qwen3.5:4b` 风格)、gguf_file、**双 download_url(modelscope→hf)**、size_mb、context_size(32768,实际按任务截断)、layer_count(2B=24 / 4B=32 / 9B 待查)、sampling 预设、template。模板常量(`QWEN35_NONTHINKING_TEMPLATE`)与转义函数随文件携带(含单测)。

**`llm/manager.rs`**:
- 模型目录:`app_data_dir/models/llm`(tauri `path().app_data_dir()`),不做进安装包;
- `scan_models() → Vec<ModelInfo{name, status: NotFound|Downloading|Ready|Corrupted, progress}>`:按 ModelDef 逐个 stat,文件大小与 `size_mb` 不符 → Corrupted;
- `download(model)`:reqwest 流式下载 → 进度经 **Tauri Event `llm://download-progress`** 推前端(百分比 + MB/s);防并发下载(单模型锁)、取消标志、跳过已完成;
- `delete(model)`、`cancel_download()`。

**`llm/sidecar.rs`**(参考 `SidecarManager`):
- 二进制解析顺序:env 覆盖(`LLAMA_HELPER_PATH`) → 开发模式 `target/(debug|release)/llama-helper` → 生产 `resource_dir/binaries/llama-helper`(Tauri v2 externalBin 规则,打包名带 target triple,运行时还原);
- spawn(stdin/stdout pipe,不自启 shell)、`ping` 健康检查循环、空闲 300s 回收(`LLAMA_IDLE_TIMEOUT` 可覆盖)、生成超时 900s;
- `send_request(json) → 文本`,失败时自动重启一次再试。

**Tauri 命令面**(`lib.rs` 注册):

| 命令 | 说明 | 事件 |
| --- | --- | --- |
| `llm_list_models` | 模型清单 + 状态 | — |
| `llm_download(model)` | 触发下载 | `llm://download-progress` |
| `llm_cancel_download()` | 取消当前下载 | — |
| `llm_delete(model)` | 删除本地模型 | — |
| `llm_generate({model, messages, max_tokens?, context_size?})` | 对话/单轮生成(内部 format_prompt) | — |
| `llm_status` | helper 是否运行、当前加载模型 | `llm://status` |

### 5.4 TS 侧接入

- `src/ai/types.ts`:`ProviderKind` 增 `"builtin"`;`ProviderConfig` 无需 baseUrl/apiKey。
- `src/ai/builtin.ts`:实现 `AIProvider`——`isConfigured()` = 运行于 Tauri 且 `llm_list_models` 中存在 Ready 模型;`chat()` 薄转发 `invoke("llm_generate")`;`extractKnowledge/generateAssessment/evaluateAnswer` 沿用既有 AIProvider 契约(依赖后续 prompt pipeline 里程碑,与"加载"解耦)。
- `src/ai/registry.ts`:kind 映射 builtin 实现;OpenAI 兼容族不变。
- `src/stores/useSettingsStore.ts`:kind 默认改为 **`builtin`(已定)**;model 默认 **`qwen3.5:4b`**;保留 ollama/llama.cpp/云端入口。
- 浏览器降级:非 Tauri 环境(纯 `vite dev`)下 builtin 明确报 `not-configured`,提示"本地模型需在桌面端使用"。
- **SettingsPage 模型管理区**:展示 ModelDef 卡片(名称/大小/状态/进度条)、下载/删除/取消按钮、切换激活模型;首次进入且无 Ready 模型 → 引导一键下载**默认档(Qwen3.5-4B)**,并提供"改为 2B 轻量档"选项。

### 5.5 与学习引擎的衔接

引擎层只依赖 `AIProvider` 接口,不改 `engine/*` 任何代码。内置 Provider 就绪后,`chat` 能力立即生效;`extractKnowledge / generateAssessment / evaluateAnswer` 三条 schema pipeline 实现时自动复用本地推理(模板与 JSON 稳定预设已在 §3.3 就位)。

---

## 6. 备选方案对比与决策

| 方案 | 做法 | 优点 | 缺点 | 决策 |
| --- | --- | --- | --- | --- |
| **A. meetily 同构(推荐)** | llama-helper sidecar 进程内推理 + 自带下载 | 零外部依赖、可打包分发、模型常驻可控、中文+Qwen3.5 兼容性最优 | Rust 侧工作量最大;llama-cpp metal 首次编译 20min+ | ✅ 主方案 |
| B. 托管 llama.cpp server 子进程 | externalBin 带 llama-server,TS 走现有 HTTP kind=`llama.cpp` localhost | TS 零改动、server 特性全(流式/并发 slot) | 常驻 HTTP 进程内存更高、端口管理、模型加载生命周期难控;与 meetily 借鉴点背离 | 备选(若想快速验证可作 N0 探针) |
| C. 引导安装 Ollama | 检测/下载 Ollama + `ollama pull` | 工程量最小 | 仍是外部常驻依赖;Qwen3.5 GGUF 暂不被 Ollama 支持(多模态 mmproj);体验不算"内置加载" | 兜底,不建议 |
| D. 保持现状(HTTP 适配) | 用户自备服务 | 零开发 | 违背 local-first 承诺,门槛高 | ❌ 不作为目标 |

> **build vs buy**:meetily 代码为 MIT,本项目亦 MIT;"买"即直接 vendor meetily 相关文件再裁剪。**建议半移植**:协议 / ModelState / VRAM 计算 / 模板转义等成熟逻辑按 MIT 许可复用并注明出处;模型清单、UI、命令面按本项目重写(学习任务与会议摘要差异大)。

---

## 7. 里程碑拆解(plan → execute → commit 循环)

| 阶段 | 内容 | 验收标准 | 风险点 |
| --- | --- | --- | --- |
| **N0 骨架** | src-tauri 改 workspace;新增 llama-helper crate(仅 ping/pong);binaries/ 打包约定 | `cargo run -p llama-helper` 手动喂 `{"type":"ping"}` 得 `pong` | workspace 化对现有 tauri 构建的影响(验证 `tauri dev`) |
| **N1 推理链路** | 移植 main.rs 全量(协议/M3 缓存/M4 GPU/采样清洗)+ 单测 | 下载默认 **4B** GGUF 冒烟生成中文句子;Metal 层数正确、二次请求不重载(网络慢时可先以 0.8B 快速验证链路,再切 4B 复验) | llama-cpp-2 编译耗时与 API 差异(锁 0.1.146) |
| **N2 Rust 管理面** | llm/{models,manager,sidecar}.rs + Tauri 命令 + 事件 | `llm_list_models` 反映磁盘真实状态;下载带进度可取消;helper 空闲回收 | 下载失败/中断处理;目录权限 |
| **N3 TS 接入** | `builtin` kind + Provider + Settings UI + 默认模型引导 | 桌面端"下载→激活→引擎调用"全链路跑通(chat) | 浏览器降级体验;UI 状态机 |
| **N4 打磨** | 结构化预设调优(JSON 出题/评估样例集)、默认模型安装策略、externalBin 打包验证、更新 README | release 包开箱即用;文档归档 | 安装包 externalBin triple 命名;构建产物体积 |

> 说明:N2/N3 内部仍遵循本项目"先生成详细方案 → 执行 → 提交"的短命令工作流;每阶段独立 commit。

---

## 8. 风险矩阵

| 级别 | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| P0 | llama-cpp-2 首次编译耗时(metal,20min+)拖慢迭代 | 开发效率 | 锁 `=0.1.146`;仅 mac arm64 编 metal;N1 用 0.8B 模型冒烟;CI 缓存 target |
| P0 | GGUF(默认 4B ≈2.5GB)国内下载失败/中断 | 功能不可用 | ModelScope 主源 + HF 备源自动切换;进度/断点校验;可取消;文件大小校验防损坏;网络差时可先选 2B 档 |
| P1 | 结构化(JSON)输出不稳定 | 出题/评估质量 | 默认 4B 已显著缓解;`tight_structured` 预设 + 模板防注入转义 + 后续 schema pipeline 容错重试兜底 |
| P1 | 模型常驻内存(4B Q4 权重 ~2.5GB + KV cache ≈4~6GB) | 后台占用 | 空闲 300s 自动 unload;context 按任务截断(默认不拉满 32K);设置页可视化"占用/卸载"并提示可切 2B 轻量档 |
| P1 | sidecar 并发:单进程串行生成,多请求排队 | 并发卡顿 | 学习场景低频,串行可接受;RequestGuard 排队;必要时二期扩展流式/双 slot |
| P2 | Qwen3.5 多模态 mmproj 分离(Ollama 不支持) | 生态依赖 | 纯文本任务只需主 GGUF;vision 能力列入远期,不进本期 |
| P2 | externalBin 打包(target-triple 改名)在 release 生效验证 | 发版 | N4 出 release 包专门验收;开发模式走编译产物路径 |

---

## 9. 决策记录

五项关键决策已于 2026-09-07 全部确认(见 §0.1):`builtin` 为默认 Provider、默认档 Qwen3.5-4B、下载双源(魔搭主+HF 备)、本期启用 Metal(mac arm64)、scope 仅 LLM 文本。

**实现期遗留的开放项**(不阻塞 N0–N3,进入对应阶段时再定):
- 9B 档的准确 `layer_count` 与魔搭/HF 直链 HEAD 校验(下载器需先探测镜像分支 `master`/`main`);
- 是否提供"下载前可自由切换默认档位"的首次引导文案顺序(默认推 4B,弱网提示 2B);
- `builtin` 与 `llama.cpp`(外部 server)kind 在设置页的分组与文案区隔,避免用户混淆"内置加载"与"外部服务"。

---

## 附:A. meetily → 本项目映射表

| meetily | 本项目对应 |
| --- | --- |
| `llama-helper/` crate | `src-tauri/llama-helper/`(同构) |
| `summary_engine/models.rs`(ModelDef+模板) | `src-tauri/src/llm/models.rs` |
| `summary_engine/model_manager.rs` | `src-tauri/src/llm/manager.rs` |
| `summary_engine/sidecar.rs` | `src-tauri/src/llm/sidecar.rs` |
| `bundle.externalBin: ["binaries/llama-helper"]` | `src-tauri/binaries/`(同约定) |
| provider `builtin-ai`(Qwen3.5 2B/4B) | ProviderKind `builtin` |
| Settings 模型管理 tab | `SettingsPage` 模型管理区 |
| HuggingFace 单源下载 | ModelScope 主 + HF 备(国内增强) |

## 附:B. 参考链接

- meetily 仓库:https://github.com/Zackriya-Solutions/meetily (MIT)
- Qwen3.5 GGUF(unsloth):HF `unsloth/Qwen3.5-{0.8B,2B,4B,9B}-GGUF` · 魔搭 `unsloth/Qwen3.5-{...}-GGUF`
- Qwen3.5 本地运行官方指南:https://unsloth.ai/docs/models/qwen3.5 (Small 系列默认非 thinking;需 llama.cpp 系后端)

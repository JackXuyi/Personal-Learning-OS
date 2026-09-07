# binaries/

Sidecar 二进制打包目录(Tauri `bundle.externalBin` 约定)。

`llama-helper` 在此目录编译并随应用分发;打包时 Tauri 要求文件名为
`llama-helper-<target-triple>`(如 `llama-helper-aarch64-apple-darwin`)。

开发模式(`tauri dev`)不需要本目录——主应用直接 spawn
`target/(debug|release)/llama-helper`(见 `src/llm/sidecar.rs` 的解析顺序)。

正式打包前需执行:

```bash
# 以 metal 特性(Apple Silicon)构建 helper 并拷入 binaries/
cargo build -p llama-helper --release -F metal
cp target/release/llama-helper \
   "binaries/llama-helper-$(rustc -vV | sed -n 's/host: //p')"
```

模型 GGUF 不进安装包,首次运行时由应用按需下载(见
`docs/local-llm-loading-plan-2026-09.md` §5.3)。

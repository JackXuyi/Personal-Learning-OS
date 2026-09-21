/**
 * 知识包 JSON 解析 Worker —— **职责刻意收窄为一件事**：把一段文本解析成结构化对象。
 *
 * 为什么存在：`JSON.parse` 在 100 MiB 量级要 1–3 s，跑在主线程会让整个界面冻结（D7-②）。
 *
 * 边界（**不许扩张**，否则就会出现「第二套解析语义」）：
 *   - 不碰存储、不碰 DOM、**不做任何校验** —— 只 `JSON.parse` 后原样回传；
 *   - 校验、容量判定、写入**全部仍在主线程**由 `parsePack` / `importPack` 完成；
 *   - 因此「走不走 Worker」**不改变任何结果**（单测用深度相等锁死）。
 *
 * ⚠️ 刻意**不**引 `/// <reference lib="webworker" />`：它与 DOM lib 同时加载会重复
 * 声明 `self` / `postMessage`，为这一个文件改全局 lib 不值。改用**结构性类型**描述
 * 本文件真正用到的那两个成员即可。
 */

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ raw: string }>) => void) | null;
  postMessage(message: unknown): void;
}

const ctx = self as unknown as WorkerScope;

ctx.onmessage = (e) => {
  try {
    ctx.postMessage({ ok: true, value: JSON.parse(e.data.raw) });
  } catch (err) {
    // ⚠️ Error 对象不可结构化克隆 → 只回传字符串（主线程统一归入 PackErrorKind "not-json"）
    ctx.postMessage({ ok: false, error: String(err) });
  }
};

export {};

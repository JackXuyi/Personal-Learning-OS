/**
 * AI 任务注册表（useAiTaskStore / runAiTask）状态机单测
 * （docs/ai-loading-unify-design-2026-09.md §12）。
 *
 * 运行：
 *   npm run test:aitask
 *
 * 覆盖：
 *  - TC-UC01-01  run 正常完成 → running → done；
 *  - TC-UC01-02  run 抛错 → error + message，并向调用方 rethrow；
 *  - TC-UC02-01  start 后任意读取方可见 running + phase/progress（同 id 重挂语义）；
 *  - TC-UC02-02  迟到 setPhase / finish（终态后）被忽略；
 *  - TC-UC03-01  终态保留至下次 start / clear；
 *  - TC-UC04-01  静默回退：fn 不抛错且未显式 done → finally 补 finish("done")；
 *                显式 done(message) → 终态带结果文案；
 *  - TC-EDGE-01  同任务防重入：running 中再次 run 抛 task-already-running；
 *  - TC-EDGE-02  幂等重入依据：完成后 status === "done"（判卷页 skipIfFinished 数据源）；
 *  - clear       显式清除记录。
 */
import assert from "node:assert/strict";
import { useAiTaskStore, runAiTask } from "../src/stores/useAiTaskStore.ts";
import { isTerminalFresh, AI_TASK_TERMINAL_TTL_MS } from "../src/stores/ai-task-types.ts";
import type { AiTaskId } from "../src/stores/ai-task-types.ts";

const results: string[] = [];
let failures = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const A = "overview:doc-a" as AiTaskId;
const B = "grade:paper-b" as AiTaskId;

function reset() {
  for (const id of Object.keys(useAiTaskStore.getState().tasks)) {
    useAiTaskStore.getState().clear(id as AiTaskId);
  }
}

await check("TC-UC01-01 run 正常完成 → running → done", async () => {
  reset();
  const d = deferred<string>();
  const p = runAiTask(A, () => d.promise);
  assert.equal(useAiTaskStore.getState().tasks[A]?.status, "running");
  d.resolve("ok");
  assert.equal(await p, "ok");
  assert.equal(useAiTaskStore.getState().tasks[A]?.status, "done");
  assert.ok(useAiTaskStore.getState().tasks[A]?.endedAt);
});

await check("TC-UC01-02 run 抛错 → error + message 并 rethrow", async () => {
  reset();
  const d = deferred<void>();
  const p = runAiTask(B, () => d.promise);
  d.reject(new Error("boom"));
  await assert.rejects(p, /boom/);
  const rec = useAiTaskStore.getState().tasks[B];
  assert.equal(rec?.status, "error");
  assert.equal(rec?.message, "boom");
});

await check("TC-UC02-01 start 后同 id 读取 running + 进度（重挂语义）", () => {
  reset();
  useAiTaskStore.getState().start(A);
  const rec = useAiTaskStore.getState().tasks[A];
  assert.equal(rec?.status, "running");
  useAiTaskStore.getState().setPhase(A, "第 3/12 章", 0.25);
  const after = useAiTaskStore.getState().tasks[A];
  assert.equal(after?.phase, "第 3/12 章");
  assert.equal(after?.progress, 0.25);
});

await check("TC-UC02-02 终态后迟到 setPhase / finish 被忽略", async () => {
  reset();
  await runAiTask(A, (_report, done) => {
    done("all good");
    return Promise.resolve("x");
  });
  const before = useAiTaskStore.getState().tasks[A];
  useAiTaskStore.getState().setPhase(A, "late", 1);
  useAiTaskStore.getState().finish(A, "error", "late error");
  assert.equal(useAiTaskStore.getState().tasks[A], before);
});

await check("TC-UC03-01 终态保留至下次 start / clear", () => {
  reset();
  useAiTaskStore.getState().start(A);
  useAiTaskStore.getState().finish(A, "done", "summary");
  assert.equal(useAiTaskStore.getState().tasks[A]?.status, "done");
  assert.equal(useAiTaskStore.getState().tasks[A]?.message, "summary");
  // 下次 start 覆盖
  useAiTaskStore.getState().start(A);
  assert.equal(useAiTaskStore.getState().tasks[A]?.status, "running");
  assert.equal(useAiTaskStore.getState().tasks[A]?.message, undefined);
});

await check("TC-UC04-01 静默回退：未显式 done → finally 补 finish(done)", async () => {
  reset();
  await runAiTask(A, async () => "local-fallback");
  assert.equal(useAiTaskStore.getState().tasks[A]?.status, "done");
});

await check("TC-UC04-01b 显式 done(message) → 终态带结果文案", async () => {
  reset();
  await runAiTask(A, async (_report, done) => {
    done("AI 未就绪，已生成本地练习卷。");
    return "local";
  });
  const rec = useAiTaskStore.getState().tasks[A];
  assert.equal(rec?.status, "done");
  assert.equal(rec?.message, "AI 未就绪，已生成本地练习卷。");
});

await check("TC-EDGE-01 running 中再次 run → task-already-running，store 不变", async () => {
  reset();
  const d = deferred<void>();
  const first = runAiTask(A, () => d.promise);
  assert.equal(useAiTaskStore.getState().tasks[A]?.status, "running");
  await assert.rejects(
    runAiTask(A, async () => "second"),
    /task-already-running/,
  );
  d.resolve();
  await first;
  assert.equal(useAiTaskStore.getState().tasks[A]?.status, "done");
});

await check("TC-EDGE-02 完成后 status=done（幂等重入判断数据源）", async () => {
  reset();
  await runAiTask(B, async () => 1);
  assert.equal(useAiTaskStore.getState().tasks[B]?.status, "done");
});

await check("clear 显式清除记录", () => {
  reset();
  useAiTaskStore.getState().start(A);
  useAiTaskStore.getState().clear(A);
  assert.equal(useAiTaskStore.getState().tasks[A], undefined);
});

await check("F2-01 isTerminalFresh：无记录 → false", () => {
  assert.equal(isTerminalFresh(undefined), false);
});

await check("F2-02 isTerminalFresh：running 恒 fresh（无论 endedAt）", () => {
  assert.equal(isTerminalFresh({ status: "running" }), true);
  assert.equal(isTerminalFresh({ status: "running", endedAt: 0 }), true);
});

await check("F2-03 isTerminalFresh：终态在 TTL 窗口内 → fresh", () => {
  const now = 1_000_000;
  assert.equal(isTerminalFresh({ status: "done", endedAt: now - 1 }, now), true);
  assert.equal(
    isTerminalFresh({ status: "error", endedAt: now - AI_TASK_TERMINAL_TTL_MS }, now),
    true, // 恰好等于 TTL 边界 → 仍在窗口内
  );
});

await check("F2-04 isTerminalFresh：终态超过 TTL / 无 endedAt → 过期", () => {
  const now = 1_000_000;
  assert.equal(
    isTerminalFresh({ status: "done", endedAt: now - AI_TASK_TERMINAL_TTL_MS - 1 }, now),
    false,
  );
  assert.equal(isTerminalFresh({ status: "done" }, now), false);
});

console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
} else {
  console.log(`\nall ${results.length} checks passed`);
}

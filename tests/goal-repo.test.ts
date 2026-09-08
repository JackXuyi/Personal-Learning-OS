/**
 * U0 · goal repo 数据层单测（docs/ui-workbench-plan-2026-09.md §7.2）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:goal
 *
 * 覆盖（InMemoryStorage，行为与 LocalStorageAdapter 共享基类逻辑）：
 *  1) 空库 getActiveGoal → undefined；
 *  2) 多目标未设置偏好 → 回退列表首个目标；
 *  3) setActiveGoal 后 → 返回偏好目标；
 *  4) 偏好目标被删除 → 回退首个剩余目标（脏状态防护）；
 *  5) 偏好指向不存在的 id → 回退首个目标（越界保护）；
 *  6) 清除偏好（undefined）→ 回退首个目标；
 *  7) saveGoal 幂等（同 id 覆盖）。
 */
import assert from "node:assert/strict";
import { InMemoryStorage } from "../src/storage/memory.ts";
import type { LearningGoal } from "../src/domain/goal.ts";

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

function goal(id: string): LearningGoal {
  return {
    id,
    type: "career",
    title: `目标 ${id}`,
    importance: "medium",
    requiredUnitIds: [],
    createdAt: 1,
  };
}

const run = async () => {
  const s = new InMemoryStorage();

  await check("空库 getActiveGoal → undefined", async () => {
    assert.equal(await s.getActiveGoal(), undefined);
  });

  await check("多目标未设置偏好 → 回退首个目标", async () => {
    const s2 = new InMemoryStorage();
    await s2.saveGoal(goal("g1"));
    await s2.saveGoal(goal("g2"));
    assert.equal((await s2.getActiveGoal())?.id, "g1");
  });

  await check("setActiveGoal 后 → 返回偏好目标", async () => {
    const s3 = new InMemoryStorage();
    await s3.saveGoal(goal("g1"));
    await s3.saveGoal(goal("g2"));
    await s3.setActiveGoal("g2");
    assert.equal((await s3.getActiveGoal())?.id, "g2");
  });

  await check("偏好目标被删除 → 回退首个剩余目标", async () => {
    const s4 = new InMemoryStorage();
    await s4.saveGoal(goal("g1"));
    await s4.saveGoal(goal("g2"));
    await s4.setActiveGoal("g2");
    await s4.deleteGoal("g2");
    assert.equal((await s4.getActiveGoal())?.id, "g1");
  });

  await check("偏好指向不存在的 id → 回退首个目标", async () => {
    const s5 = new InMemoryStorage();
    await s5.saveGoal(goal("g1"));
    await s5.setActiveGoal("missing");
    assert.equal((await s5.getActiveGoal())?.id, "g1");
  });

  await check("清除偏好（undefined）→ 回退首个目标", async () => {
    const s6 = new InMemoryStorage();
    await s6.saveGoal(goal("g1"));
    await s6.saveGoal(goal("g2"));
    await s6.setActiveGoal("g2");
    await s6.setActiveGoal(undefined);
    assert.equal((await s6.getActiveGoal())?.id, "g1");
  });

  await check("saveGoal 幂等（同 id 覆盖）", async () => {
    const s7 = new InMemoryStorage();
    await s7.saveGoal({ ...goal("g1"), title: "v1" });
    await s7.saveGoal({ ...goal("g1"), title: "v2" });
    const all = await s7.listGoals();
    assert.equal(all.length, 1);
    assert.equal(all[0].title, "v2");
  });

  console.log(results.join("\n"));
  console.log(`\ngoal-repo: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();

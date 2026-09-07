/**
 * 轻量自研力导向布局（T6）—— 无第三方依赖，确定性输出。
 *
 * 初始位置用黄金角螺旋散布（与输入顺序无关的稳定 seed），随后迭代
 * 斥力 + 弹簧（沿关系边）+ 向心引力。不引入随机力，因此同一份图谱
 * 每次计算得到完全相同的布局——React 重渲染不闪烁，导入新节点后
 * 只是局部平滑变化。
 *
 * 规模假设：≤ 50 节点（超出会显著变慢；届时再评估 d3-force）。
 */
import type { KnowledgeRelation, KnowledgeUnit } from "../../domain";

export interface Point {
  x: number;
  y: number;
}

export const GRAPH_W = 760;
export const GRAPH_H = 520;

const REST_LEN = 150; // 有边节点间的理想距离
const REPULSION = 52_000; // 斥力强度（Coulomb 型 k/d²）
const SPRING_K = 0.012; // 弹簧强度
const CENTER_K = 0.02; // 向心引力
const DAMPING = 0.82;
const MIN_DIST = 26;

export interface LayoutInput {
  units: KnowledgeUnit[];
  relations: KnowledgeRelation[];
}

/** 黄金角螺旋 seed，按数组序给每个节点一个初始位置。 */
function spiralSeed(count: number): Point[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const t = count > 1 ? i / (count - 1) : 0;
    const r = 40 + t * (Math.min(GRAPH_W, GRAPH_H) / 2 - 70);
    const a = i * golden;
    return {
      x: GRAPH_W / 2 + Math.cos(a) * r,
      y: GRAPH_H / 2 + Math.sin(a) * r * 0.8,
    };
  });
}

/**
 * 迭代力导向，返回 unitId → 位置。
 * iterations 越大越收敛（默认 240，通常够 50 节点内稳定）。
 */
export function computeLayout(
  { units, relations }: LayoutInput,
  iterations = 240,
): Map<string, Point> {
  const n = units.length;
  if (n === 0) return new Map();
  const ids = units.map((u) => u.id);
  const pos = new Map<string, Point>();
  const vel = new Map<string, { vx: number; vy: number }>();

  const seed = spiralSeed(n);
  ids.forEach((id, i) => {
    pos.set(id, { x: seed[i].x, y: seed[i].y });
    vel.set(id, { vx: 0, vy: 0 });
  });

  // 邻接表（无向，沿可见关系连接）
  const adj = new Map<string, string[]>();
  for (const r of relations) {
    if (!adj.has(r.fromId)) adj.set(r.fromId, []);
    if (!adj.has(r.toId)) adj.set(r.toId, []);
    adj.get(r.fromId)!.push(r.toId);
    adj.get(r.toId)!.push(r.fromId);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations; // 线性冷却

    // 斥力（全对）——O(n²) 在 ≤50 节点下可接受
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(ids[i])!;
        const b = pos.get(ids[j])!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < MIN_DIST * MIN_DIST) d2 = MIN_DIST * MIN_DIST;
        const d = Math.sqrt(d2);
        const f = (REPULSION / d2) * cooling;
        dx /= d;
        dy /= d;
        const va = vel.get(ids[i])!;
        const vb = vel.get(ids[j])!;
        va.vx -= dx * f;
        va.vy -= dy * f;
        vb.vx += dx * f;
        vb.vy += dy * f;
      }
    }

    // 弹簧（沿边）
    for (const [fromId, neighbors] of adj) {
      for (const toId of neighbors) {
        const a = pos.get(fromId)!;
        const b = pos.get(toId)!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = SPRING_K * (d - REST_LEN) * cooling;
        dx /= d;
        dy /= d;
        const va = vel.get(fromId)!;
        const vb = vel.get(toId)!;
        va.vx += dx * f;
        va.vy += dy * f;
        vb.vx -= dx * f;
        vb.vy -= dy * f;
      }
    }

    // 向心引力 + 位置积分 + 边界钳制
    for (const id of ids) {
      const p = pos.get(id)!;
      const v = vel.get(id)!;
      v.vx = (v.vx - (p.x - GRAPH_W / 2) * CENTER_K * cooling) * DAMPING;
      v.vy = (v.vy - (p.y - GRAPH_H / 2) * CENTER_K * cooling) * DAMPING;
      p.x = Math.min(GRAPH_W - 24, Math.max(24, p.x + v.vx));
      p.y = Math.min(GRAPH_H - 24, Math.max(24, p.y + v.vy));
    }
  }

  return pos;
}

/** 关系的度数（影响节点尺寸）。 */
export function degreeOf(relations: KnowledgeRelation[], unitId: string): number {
  return relations.filter((r) => r.fromId === unitId || r.toId === unitId).length;
}

/** 该单元一跳以内的邻居 id 集合。 */
export function neighborsOf(
  relations: KnowledgeRelation[],
  unitId: string,
): Set<string> {
  const out = new Set<string>();
  for (const r of relations) {
    if (r.fromId === unitId) out.add(r.toId);
    if (r.toId === unitId) out.add(r.fromId);
  }
  return out;
}

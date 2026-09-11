/**
 * 截断 JSON 抢救 —— 仅用于「模型输出被 max_tokens 截断」这一场景。
 *
 * 为什么独立成文件：`pipelines.ts` 已逼近仓库 ≤700 行硬上限，不得再堆逻辑
 * （沿用 `overview-pipeline.ts` 的先例：新能力自持，只复用既有工具）。
 * 本模块零依赖、纯函数、可 node 直测（`npm run test:ai`）。
 *
 * 策略（只保留完整元素，绝不补齐半个字段 —— 宁可少一条，不给半条）：
 * 1. 单次扫描：跟踪字符串 / 转义状态 + 括号栈；记录「最后一个完整元素
 *    消费完」的位置（该元素闭合符出栈、且栈内仍有祖先容器的时刻）。
 * 2. 有完整元素 → 截到该位置，去掉尾随逗号，按祖先栈逆序补齐闭合符。
 * 3. 无任何完整元素 → 回退容器边界：截到次内层容器开括号（该容器视为空），
 *    补齐闭合 —— 空数组 / 空对象语义清楚，不会伪造半条。
 * 4. 残留是「裸词垃圾」（无引号、无结构符的裸 token，如 `{ broken`）→
 *    不是截断而是输出本身坏掉，不修复（返回 undefined，调用方保持抛错）。
 * 5. 结构已闭合却仍解析失败、或结构错乱（`}` 与 `[` 交叉）→ 一律不修复。
 *
 * 所有候选在返回前都经 `JSON.parse` 验证，保证返回值必为合法 JSON 文本。
 */
export function repairTruncatedJson(input: string): string | undefined {
  const stack: { expect: string; pos: number }[] = [];
  let inString = false;
  let escaped = false;
  let lastElementEnd = -1;
  let lastElementStack: string[] | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push({ expect: ch === "{" ? "}" : "]", pos: i });
    } else if (ch === "}" || ch === "]") {
      const top = stack.pop();
      if (!top || top.expect !== ch) return undefined; // 结构错乱，不修复
      if (stack.length > 0) {
        // 出栈后栈内仍有祖先 → 刚消费完一个完整元素，记为安全边界
        lastElementEnd = i;
        lastElementStack = stack.map((s) => s.expect);
      }
    }
  }

  // 整体已闭合（栈空）却仍 parse 失败 → 不是截断问题，交回调用方原路径
  if (stack.length === 0) return undefined;

  // 情形 A：存在完整元素 → 截到最后一个完整元素，补齐祖先闭合符
  if (lastElementStack) {
    const head = input.slice(0, lastElementEnd + 1).replace(/[,\s]+$/, "");
    return tryClose(head, lastElementStack);
  }

  // 情形 B：无任何完整元素 → 回退容器边界（截到次内层 / 唯一容器开括号）
  const fallback = stack.length >= 2 ? stack[stack.length - 2]! : stack[0]!;
  const residue = input.slice(fallback.pos + 1).replace(/\s+/g, "");
  if (residue.length > 0 && /^[\w\-.+]+$/.test(residue)) {
    return undefined; // 裸词垃圾（如 "{ broken"），不是截断，不修复
  }
  const keep = stack.length >= 2 ? stack.length - 1 : 1;
  const head = input.slice(0, fallback.pos + 1);
  return tryClose(head, stack.slice(0, keep).map((s) => s.expect));
}

/** 补齐闭合符并做防御性验证：parse 失败即视为不可修复（返回 undefined）。 */
function tryClose(head: string, expectClosers: string[]): string | undefined {
  const candidate = head + [...expectClosers].reverse().join("");
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

/**
 * useAliveRef —— 「组件是否仍挂载」的 ref 守卫。
 *
 * 为什么有这个 hook：三个异步面板（章内提问 `ChapterQaPanel` / 费曼复述
 * `ChapterRestatementPanel` / 卡片会话 `CardSession`）各自抄了**逐字相同**的
 * `useRef(true)` + `useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, [])`
 * 七行守卫 —— 切章 / 切页卸载组件后，在途的 AI / 存储调用回来再 `setState`
 * 会写已卸组件。同一逻辑跨 ≥3 处 ⇒ 收成一个 hook
 * （`rules/code-structure-and-dependencies.mdc`：同一模式跨 ≥3 处必须抽取）。
 *
 * 用法：`const aliveRef = useAliveRef();`，此后每个 `await` 之后
 * `if (!aliveRef.current) return;`（`finally` 里也要判，否则卸载后仍会 `setState`）。
 *
 * ⚠️ 它**只**回答「是否仍挂载」，不做请求取消 —— 中断在途请求是各调用方自己的事。
 * 初始值统一 `true`（首帧即视为存活），因此 effect 之前拿到的也是 `true`。
 *
 * 依赖方向：hooks → react；不依赖 stores / features。
 */
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** 挂载期恒 `true`、卸载后置 `false` 的 ref。 */
export function useAliveRef(): RefObject<boolean> {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return ref;
}

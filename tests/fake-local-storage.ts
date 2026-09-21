/**
 * 最小 localStorage 替身（`local` 后端测试用）。
 *
 * 为什么共享：`data-portability.test.ts`（F4 的 clearAll 键清理契约）与
 * `storage-documents.test.ts`（F10 的迁移 flag / 快照冻结）都要它。两处各抄一份
 * 就是测试脚手架层面的「两把尺子」—— 替身行为一旦分叉，两边的绿就不再等价。
 *
 * 本仓库**禁起浏览器**（`rules/no-headless-browser-validation.mdc`），而
 * `LocalStorageAdapter` 的行为只在这个后端上有意义 → 用替身换确定性覆盖。
 */

export interface FakeLocalStorage {
  /** 当前所有 key（断言「残留 / 未清」用）。 */
  keys: () => Iterable<string>;
  /** 当前某个 key 的原始字符串值（断言「冻结快照没被重写」用）。 */
  raw: (key: string) => string | null;
  /** 直接塞一个 key（不需要走 setItem 的时机控制时用）。 */
  seed: (key: string, value: string) => void;
  uninstall: () => void;
}

/** 装上替身并返回句柄；调用方**必须**在用例结束时 `uninstall()`。 */
export function installFakeLocalStorage(): FakeLocalStorage {
  const map = new Map<string, string>();
  const fake = {
    getItem: (k: string): string | null => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string): void => void map.set(k, String(v)),
    removeItem: (k: string): void => void map.delete(k),
    clear: (): void => map.clear(),
    key: (i: number): string | null => [...map.keys()][i] ?? null,
    get length(): number {
      return map.size;
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: fake,
    configurable: true,
    writable: true,
  });
  return {
    keys: () => map.keys(),
    raw: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    seed: (key: string, value: string) => void map.set(key, value),
    uninstall: () => {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as Record<string, unknown>).localStorage;
    },
  };
}

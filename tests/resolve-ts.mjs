/**
 * T5 测试专用 ESM resolver —— 让 Node --experimental-strip-types 直跑仓库源码。
 *
 * 仓库源码采用 bundler 风格的无扩展名相对导入（如 `from "../domain"`），
 * Node 原生解析不了；本 loader 兜底追加 .ts/.tsx/index.ts 后缀。
 * 仅供 tests/ 内 Node 直跑使用，不参与应用构建。
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  // 1) 先让 Node 自己试（builtin / node_modules / 带显式扩展名的相对路径）。
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // 仅对「相对/绝对源码导入」做后缀兜底；bare specifier（包名）原样抛错。
    const isRelative = specifier.startsWith(".") || specifier.startsWith("/");
    const isFileUri = /^[a-z][a-z0-9+.-]*:/.test(specifier);
    if (!isRelative && !isFileUri) throw err;
    if (/\.(ts|tsx|mjs|cjs|js|mts|cts|json)$/.test(specifier)) throw err;

    const base = new URL(specifier, context.parentURL ?? "file:///");
    const basePath = fileURLToPath(base);
    for (const suffix of CANDIDATES) {
      const candidate = basePath + suffix;
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    throw err;
  }
}

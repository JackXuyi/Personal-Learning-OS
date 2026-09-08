/** 预加载：把 resolve-ts loader 注册进当前 Node 进程（Node >= 20.6 的 module.register）。 */
import { register } from "node:module";

register(new URL("./resolve-ts.mjs", import.meta.url).href);

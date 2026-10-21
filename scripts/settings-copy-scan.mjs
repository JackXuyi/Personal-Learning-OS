/**
 * 设置页用户可见文案的技术术语扫描（docs/settings-left-menu-layout-design-2026-10.md §9.7）。
 *
 * 判据只扫**值**（用户真正看得到的那句），不扫键名 / 参数名 / 源码注释 —— 否则
 * `localStorageNote`、`errSqliteBlocked`、`previewMeta(backend…)` 这类标识符会让门禁永远红着，
 * 退化成「假门禁」。
 *
 * 用法：`npm run copy:check`（命中即退出码 1）。
 */
const BAD_ZH = /localStorage|SQLite|Tauri|JSON|Keychain|钥匙串|npm run|引擎|阈值|后端|Pre-MVP|Workbench|plosbak|ploskp/;
const BAD_EN =
  /localStorage|SQLite|Tauri|JSON|Keychain|npm run|engine|threshold|backend|Pre-MVP|Workbench|plosbak|ploskp/i;

const { zh } = await import("../src/i18n/messages/zh.ts");
const { en } = await import("../src/i18n/messages/en.ts");

/** 摊平所有叶子值（字符串 / 无参插值函数 / 数组项）。 */
function leaves(node, path = "", out = []) {
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === "string") out.push([p, v]);
    else if (typeof v === "function") {
      let s = "";
      try {
        s = String(v(1, 1, "x", "x"));
      } catch {
        s = "";
      }
      out.push([p, s]);
    } else if (Array.isArray(v)) {
      v.forEach((it, i) => {
        if (typeof it === "string") out.push([`${p}[${i}]`, it]);
        else if (it && typeof it === "object") leaves(it, `${p}[${i}]`, out);
      });
    } else if (v && typeof v === "object") leaves(v, p, out);
  }
  return out;
}

let failed = 0;
for (const [name, dict, bad] of [
  ["zh", zh, BAD_ZH],
  ["en", en, BAD_EN],
]) {
  const targets = [
    ...leaves(dict.settings, "settings"),
    // 主侧栏小字 / 命令面板说明 / 设置页副标题同源（用户点名要改的那条）。
    ["nav.settings.hint", dict.nav.settings.hint],
  ];
  const hits = targets.filter(([, s]) => bad.test(s));
  if (hits.length === 0) {
    console.log(`✅ ${name}：设置页用户可见文案无技术术语（0 命中）`);
  } else {
    failed += hits.length;
    console.log(`❌ ${name}：${hits.length} 处命中`);
    for (const [p, s] of hits) console.log(`   ${p} = ${s.slice(0, 100)}`);
  }
}

if (failed > 0) process.exit(1);

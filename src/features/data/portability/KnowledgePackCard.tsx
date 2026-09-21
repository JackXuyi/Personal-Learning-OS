/**
 * 社区知识包卡片（设置 → 本地存储）—— 导出 / 导入 / 已导入列表
 * （方案 `docs/community-knowledge-pack-design-2026-09.md` §4.3.3 / §4.3.4 / §8.12）。
 *
 * 约定（与 `DataPortabilityCard`（F4）同源，刻意不发明第二套）：
 *  - 文案全部走 i18n；**错误只存分类**，渲染时才映射文案（服务层只产 enum）；
 *  - 不新增 store、不新增持久化 key：导出 / 导入是一次性动作，状态留在组件里；
 *    唯一落库的东西是「已导入的知识包记录」（本机资产，D6，走 `storage`）；
 *  - 导入完成后必须刷新既有 store（`storage` 是模块级单例，其他页面持有内存镜像，
 *    不刷新就会出现「资料库还显示旧文档」）。
 *
 * ⚠️ 与备份卡（F4）的**三条刻意差异**：
 *  1. **没有「替换」模式** —— 包是「加内容」，不是「换整库」，故不调 `clearAll`；
 *  2. **容量文案只在后端给出容量时才可能出现**（D16）：桌面端 `storeCapacityBytes`
 *     为 `undefined`（文档 / 章节已下沉 SQLite，不设应用层上限）→ 导出侧不产
 *     `too-large` 警告、导入侧整步跳过。本组件**不复述**容量数字，也不写
 *     「约 4 MB」这类硬编码提示（两把尺子陷阱）。
 *  3. 「移除记录」只删记录、**不删资料**（资料的删除有自己的级联口径）。
 */
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../../components/primitives";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { Spinner } from "../../../components/ui/spinner";
import { Textarea } from "../../../components/ui/textarea";
import { useI18n } from "../../../i18n";
import { storage, useLoopStore } from "../../../stores/useLoopStore";
import { useIndexStore } from "../../../stores/useIndexStore";
import type { ImportedPackRecord } from "../../../storage/types";
import { decodeBytes } from "../../learn/import/decode";
import { humanBytes } from "./backup-format";
import { backupSave, downloadText, isDesktopBackupAvailable } from "./desktop-backup";
import { buildPack } from "./pack-export-service";
import type { PackSelection, PackWarning } from "./pack-export-service";
import { defaultPackName, parsePack } from "./pack-format";
import type { KnowledgePackFile, PackLicense } from "./pack-format";
import { importPack } from "./pack-import-service";
import type { PackImportStats } from "./pack-import-service";
import { PackRemoteError, fetchPackText, parsePackUrl } from "./pack-remote";
import { findExisting, packRowsOf, recordOfPack } from "./pack-registry";
import type { PackRow } from "./pack-registry";
import { errorText, packCountsText, warningText } from "./pack-texts";
import type { PackUiErrorKind } from "./pack-texts";

/** 设置页传入的可打包资料（标题由设置页与计数**同源**读出）。 */
export interface PackCandidate {
  id: string;
  title: string;
}

interface Props {
  /** 未就绪 = `undefined`（此时不渲染选择器与「已导入」列表，避免谎报「一份都没有」）。 */
  docs?: PackCandidate[];
  /** 导入成功后通知父级重算数据规模（与 F4 同一个回调）。 */
  onDataChanged?: () => void;
}

type Busy = "export" | "parse" | "fetch" | "import";

interface PackForm {
  title: string;
  description: string;
  author: string;
  /** `""` = 未声明（`PackLicense` 不含空值 → 导出时不写 `license` 字段）。 */
  license: PackLicense | "";
}

/**
 * 表单初值。
 *
 * ⚠️ 许可默认**未声明**而不是替用户挑一个：许可声明是**作者的法律选择**，
 * 我们无权代填（`cc-by` 会成为一份用户并不知情的授权）。
 */
const EMPTY_FORM: PackForm = { title: "", description: "", author: "", license: "" };

const LICENSE_VALUES: readonly PackLicense[] = [
  "cc0",
  "cc-by",
  "cc-by-sa",
  "public-domain",
  "other",
];

/** 预览态（已解析、未写入）。 */
interface PackPreview {
  raw: string;
  file: KnowledgePackFile;
  bytes: number;
  /** 链接导入时填（会随记录一起留下作溯源）。 */
  sourceUrl?: string;
}

/** 导出结果回显。 */
interface Exported {
  name: string;
  bytes: number;
  /** 桌面端：绝对路径；浏览器：`undefined`（走下载）。 */
  path?: string;
  warnings: PackWarning[];
}

interface PackUiError {
  kind: PackUiErrorKind;
  detail?: string;
}

export default function KnowledgePackCard({ docs, onDataChanged }: Props) {
  const { m } = useI18n();
  const d = m.settings.storage.data;
  const p = d.pack;
  const navigate = useNavigate();
  const desktop = isDesktopBackupAvailable();

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [form, setForm] = useState<PackForm>(EMPTY_FORM);
  const [busy, setBusy] = useState<Busy>();
  const [preview, setPreview] = useState<PackPreview>();
  const [exported, setExported] = useState<Exported>();
  const [result, setResult] = useState<PackImportStats>();
  const [error, setError] = useState<PackUiError>();
  const [url, setUrl] = useState("");
  /** `undefined` = 未就绪（读失败或尚未读到）→ 「已导入」分区整体不渲染。 */
  const [records, setRecords] = useState<ImportedPackRecord[]>();

  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * 时间基准入口（方案 §8.12 的规格要求：服务层**不取** `Date.now()`，由组件注入）。
   *
   * ⚠️ 用 ref 而非 state：它不参与渲染，改它不该触发重渲染。
   * ⚠️ 每次动作前刷新一次，**而不是只取挂载时刻** —— 卡片可能随设置页挂载数小时，
   *    沿用挂载时刻会让「已导入」列表里的时间整体偏早（可见的错数据）。
   */
  const nowRef = useRef(Date.now());
  const stampNow = (): number => (nowRef.current = Date.now());

  useEffect(() => {
    void loadRecords();
  }, []);

  async function loadRecords() {
    try {
      setRecords(await storage.listImportedPacks());
    } catch {
      // 读失败 → 保持「未就绪」：宁可整块不显示，也不要谎报「还没有导入过任何知识包」。
    }
  }

  /* ---------------- 导数（全部由 state 派生，不额外读库） ---------------- */

  const docIds = new Set((docs ?? []).map((x) => x.id));
  // 过滤掉已被删除的资料 id：`selected` 是点击累加出来的，资料可能在选中后被删。
  const selectedIds = [...selected].filter((id) => docIds.has(id));
  // 「这份包导入过」——从既有记录里按 contentHash 反查（记录才是真源，不用额外状态）。
  const existing = preview ? findExisting(records ?? [], preview.file.manifest.contentHash) : undefined;
  // ⚠️ `docs` 缺失时**不**能算「已导入」列表：`packRowsOf` 需要「哪些资料还活着」的
  //    全量集合，喂空集合会把每条记录都误标成 `allGone`（全部已删除）。
  const rows: PackRow[] | undefined =
    records !== undefined && docs !== undefined ? packRowsOf(records, docIds) : undefined;

  /* ---------------- 导出 ---------------- */

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function doExport() {
    if (selectedIds.length === 0) return;
    setBusy("export");
    setError(undefined);
    setExported(undefined);
    try {
      const sel: PackSelection = {
        documentIds: selectedIds,
        manifest: {
          // ⚠️ 「N 份资料」这类兜底是**文案**，只能在这里出 —— 服务层零文案纪律
          //    （`i18n` 没有 React 外的消息访问器，故由 UI 经 i18n 传入）。
          title: form.title.trim() || p.titlePlaceholder(selectedIds.length),
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          ...(form.author.trim() ? { author: form.author.trim() } : {}),
          ...(form.license === "" ? {} : { license: form.license }),
        },
      };
      const build = await buildPack(storage, sel);
      const name = defaultPackName(stampNow());
      if (desktop) {
        const path = await backupSave(name, build.json);
        setExported({ name, bytes: build.bytes, path, warnings: build.warnings });
      } else {
        downloadText(name, build.json);
        setExported({ name, bytes: build.bytes, warnings: build.warnings });
      }
    } catch {
      setError({ kind: "unknown" });
    } finally {
      setBusy(undefined);
    }
  }

  /* ---------------- 导入（本地文件 / 链接 → 预览 → 写入） ---------------- */

  /**
   * 解析并进入预览态。
   *
   * ⚠️ 校验失败**零写入**：`parsePack` 只回判别式结果，没有任何副作用；真正的写入
   * 发生在用户点「导入」之后的 `importPack` 里（它内部还有 ③ 容量前置拒）。
   */
  async function openPreview(raw: string, sourceUrl?: string) {
    const parsed = await parsePack(raw);
    if (!parsed.ok) {
      setPreview(undefined);
      setError({ kind: parsed.kind, detail: parsed.detail });
      return;
    }
    setError(undefined);
    setResult(undefined);
    setPreview({
      raw,
      file: parsed.file,
      bytes: parsed.bytes,
      ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    });
  }

  async function doLoadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 清空 input：允许重复选同一个文件（第二次 change 才会再触发）。
    event.target.value = "";
    if (!file) return;
    setBusy("parse");
    setError(undefined);
    setPreview(undefined);
    setResult(undefined);
    try {
      const raw = decodeBytes(await file.arrayBuffer()).text;
      await openPreview(raw);
    } catch {
      setError({ kind: "unknown" });
    } finally {
      setBusy(undefined);
    }
  }

  async function doFetchUrl() {
    const raw = url.trim();
    const parsedUrl = parsePackUrl(raw);
    if (!parsedUrl.ok) {
      setError({ kind: "invalid" });
      return;
    }
    setBusy("fetch");
    setError(undefined);
    setPreview(undefined);
    setResult(undefined);
    try {
      // 显式包一层箭头函数：避免把 `fetch` 以「脱离宿主」的形式传下去
      // （部分实现对脱离 `window` 的调用会抛 Illegal invocation）。
      const text = await fetchPackText((input, init) => fetch(input, init), parsedUrl.url);
      await openPreview(text, parsedUrl.url);
    } catch (err) {
      setError(
        err instanceof PackRemoteError
          ? { kind: err.kind, detail: err.message }
          : { kind: "unknown" },
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function doImport() {
    if (!preview) return;
    // ⚠️ 一次动作一个 `now`：`importPack` 的记录时刻与 `recordOfPack` 的 `importedAt`
    //    必须是**同一个数**，否则列表时间与数据时间会差几毫秒（无法核对）。
    const stamp = stampNow();
    setBusy("import");
    setError(undefined);
    setResult(undefined);
    try {
      const outcome = await importPack(storage, preview.raw, {
        now: stamp,
        ...(preview.sourceUrl !== undefined ? { sourceUrl: preview.sourceUrl } : {}),
      });
      if (!outcome.ok) {
        setError({ kind: outcome.kind, detail: outcome.detail });
        return;
      }
      setResult(outcome.stats);
      setPreview(undefined);
      // 「已导入的记录」是本机资产（D6）：资料已落库，记录写失败不该回滚导入 ——
      // 单独 try 包住，失败只影响「已导入」列表（下次打开设置页再同步）。
      try {
        const previous = findExisting(records ?? [], outcome.stats.contentHash);
        await storage.saveImportedPack(
          recordOfPack(preview.file, outcome.stats, {
            now: stamp,
            ...(preview.sourceUrl !== undefined ? { sourceUrl: preview.sourceUrl } : {}),
            ...(previous !== undefined ? { previous } : {}),
          }),
        );
        await loadRecords();
      } catch {
        /* 记录写入失败：资料已导入，列表下次打开再同步 */
      }
      await refreshAfterImport();
      onDataChanged?.();
    } catch {
      setError({ kind: "unknown" });
    } finally {
      setBusy(undefined);
    }
  }

  /**
   * 导入后刷新：`storage` 是模块级单例，各页面持有它的内存镜像 —— 不刷新就会出现
   * 「资料库还显示旧文档」的脏状态（与 F4 `refreshAfterImport` 同一口径）。
   */
  async function refreshAfterImport() {
    try {
      await useLoopStore.getState().refresh(m);
    } catch {
      /* 刷新失败不回滚导入：数据已落库，页面重进即可 */
    }
    try {
      await useIndexStore.getState().refreshCoverage();
    } catch {
      /* 覆盖率是派生统计，失败不影响已写入的数据 */
    }
  }

  async function removeRecord(contentHash: string) {
    setError(undefined);
    try {
      await storage.deleteImportedPack(contentHash);
      await loadRecords();
    } catch {
      setError({ kind: "unknown" });
    }
  }

  /* ---------------- 渲染 ---------------- */

  const canExport = !busy && selectedIds.length > 0;

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-1">{p.title}</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{p.desc}</p>
      </div>

      {/* ── 导出知识包 ── */}
      <div className="border-t border-line pt-3">
        <p className="text-sm text-ink-1">{p.exportTitle}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">{p.exportPick}</p>

        {docs === undefined ? (
          <p className="mt-2 text-[11px] text-ink-3">{m.common.loading}</p>
        ) : docs.length === 0 ? (
          <p className="mt-2 text-[11px] text-ink-3">{p.exportNoDocs}</p>
        ) : (
          <>
            <div
              data-testid="settings-pack-docs"
              className="mt-2 max-h-48 space-y-1 overflow-auto rounded-lg border border-line bg-subtle/60 p-2"
            >
              {docs.map((doc) => (
                <label
                  key={doc.id}
                  className="flex cursor-pointer items-center gap-2 text-xs text-ink-2"
                >
                  <Checkbox
                    data-testid={`settings-pack-doc-${doc.id}`}
                    checked={selected.has(doc.id)}
                    onCheckedChange={(v) => toggle(doc.id, v === true)}
                  />
                  <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                </label>
              ))}
            </div>
            {/* 未选任何资料时不渲染「已选 0 份」—— 空话不占位（提示语已在上面）。 */}
            {selectedIds.length > 0 ? (
              <p className="mt-1.5 text-[11px] text-ink-3">
                {p.exportSelected(selectedIds.length)}
                <button
                  type="button"
                  data-testid="settings-pack-clear"
                  disabled={!!busy}
                  onClick={() => setSelected(new Set())}
                  className="ml-2 underline underline-offset-2 transition-colors hover:text-ink-1 disabled:opacity-50"
                >
                  {p.exportClear}
                </button>
              </p>
            ) : null}

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <Label className="mb-1 block" htmlFor="pack-title">
                  {p.titleLabel}
                </Label>
                <Input
                  id="pack-title"
                  data-testid="settings-pack-title"
                  className="h-8 text-xs"
                  value={form.title}
                  placeholder={p.titlePlaceholder(selectedIds.length)}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="pack-author">
                  {p.authorLabel}
                </Label>
                <Input
                  id="pack-author"
                  data-testid="settings-pack-author"
                  className="h-8 text-xs"
                  value={form.author}
                  onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
                />
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="pack-license">
                  {p.licenseLabel}
                </Label>
                <Select
                  id="pack-license"
                  value={form.license}
                  onValueChange={(v) => setForm((f) => ({ ...f, license: v as PackLicense | "" }))}
                  ariaLabel={p.licenseLabel}
                  className="h-8 text-xs"
                  options={[
                    { value: "", label: p.licenseNone },
                    ...LICENSE_VALUES.map((v) => ({ value: v, label: p.licenses[v] })),
                  ]}
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1 block" htmlFor="pack-desc">
                  {p.descLabel}
                </Label>
                <Textarea
                  id="pack-desc"
                  data-testid="settings-pack-desc"
                  rows={2}
                  className="text-xs"
                  value={form.description}
                  placeholder={p.descPlaceholder}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-2">
              <Button
                type="button"
                data-testid="settings-pack-export"
                disabled={!canExport}
                onClick={() => void doExport()}
              >
                {busy === "export" ? <Spinner className="size-3.5" /> : null}
                {busy === "export" ? p.exporting : p.export}
              </Button>
            </div>
          </>
        )}

        {exported ? (
          <div
            data-testid="settings-pack-export-done"
            className="mt-2 space-y-1 text-xs text-ink-2"
          >
            <p className="break-all">
              ✓ {exported.path ? p.exportDonePath(exported.path) : p.exportDoneDownload}（
              {exported.name}）
            </p>
            <p className="text-[11px] text-ink-3">{p.exportSize(humanBytes(exported.bytes))}</p>
            {exported.warnings.map((w) => (
              <p key={w.kind} className="text-[11px] text-state-weak">
                ⚠ {warningText(p, w)}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── 导入知识包 ── */}
      <div className="border-t border-line pt-3">
        <p className="text-sm text-ink-1">{p.importTitle}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">{p.importHint}</p>

        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void doLoadFile(e)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="settings-pack-file"
            disabled={!!busy}
            onClick={() => fileInput.current?.click()}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-50"
          >
            {busy === "parse" ? <Spinner className="mr-1 inline size-3.5" /> : null}
            {p.importPick}
          </button>
          <span className="text-[11px] text-ink-3">{p.importUrlLabel}</span>
          <Input
            data-testid="settings-pack-url"
            className="h-8 w-64 text-xs"
            value={url}
            placeholder={p.importUrlPlaceholder}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="settings-pack-fetch"
            disabled={!!busy || url.trim().length === 0}
            onClick={() => void doFetchUrl()}
          >
            {busy === "fetch" ? <Spinner className="size-3.5" /> : null}
            {busy === "fetch" ? p.fetching : p.importFetch}
          </Button>
        </div>

        {/* 预览态（已解析、未写入） */}
        {preview ? (
          <div
            data-testid="settings-pack-preview"
            className="mt-3 space-y-2 rounded-lg border border-line bg-subtle/60 p-3"
          >
            <p className="text-xs font-medium text-ink-1">
              {p.previewTitle}：{preview.file.manifest.title}
            </p>
            <p className="text-[11px] text-ink-3">
              {preview.file.manifest.author
                ? `${p.previewAuthor(preview.file.manifest.author)} · `
                : ""}
              {humanBytes(preview.bytes)}
            </p>
            <p data-testid="settings-pack-preview-counts" className="text-xs text-ink-2">
              {packCountsText(d, preview.file.counts)}
            </p>
            {preview.file.manifest.aiDerived ? (
              <p className="text-[11px] text-ink-3">• {p.previewAiDerived}</p>
            ) : null}
            {existing !== undefined ? (
              <p data-testid="settings-pack-already" className="text-[11px] text-state-weak">
                • {p.previewAlreadyImported}
              </p>
            ) : null}

            <div className="flex gap-2 border-t border-line pt-2">
              <Button
                type="button"
                data-testid="settings-pack-import"
                disabled={!!busy}
                onClick={() => void doImport()}
              >
                {busy === "import" ? <Spinner className="size-3.5" /> : null}
                {busy === "import" ? p.importing : p.import}
              </Button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => setPreview(undefined)}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-50"
              >
                {d.cancel}
              </button>
            </div>
          </div>
        ) : null}

        {/* 结果态 */}
        {result ? (
          <div
            data-testid="settings-pack-result"
            className="mt-3 space-y-1 rounded-lg border border-line bg-subtle/60 p-3 text-xs text-ink-2"
          >
            <p className="font-medium text-ink-1">{p.importDone(result.packTitle)}</p>
            <p>{p.stats(packCountsText(d, result))}</p>
            {result.foreignProgressDropped > 0 ? (
              <p>{p.statsForeignProgress(result.foreignProgressDropped)}</p>
            ) : null}
            {result.danglingCleared > 0 ? <p>{p.statsDangling(result.danglingCleared)}</p> : null}
            {result.relationsDropped > 0 ? (
              <p>{p.statsRelationsDropped(result.relationsDropped)}</p>
            ) : null}
          </div>
        ) : null}

        {/* 已导入的知识包（记录是本机资产；列表需知道「哪些资料还活着」→ 未就绪不渲染） */}
        {rows !== undefined ? (
          <div data-testid="settings-pack-records" className="mt-3 border-t border-line pt-3">
            <p className="text-[11px] font-medium text-ink-3">{p.importedTitle}</p>
            {rows.length === 0 ? (
              <p className="mt-1 text-[11px] text-ink-3">{p.importedEmpty}</p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {rows.map((row) => (
                  <li
                    key={row.contentHash}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-ink-1">{row.title}</span>
                      <span className="block text-[11px] text-ink-3">
                        {row.author ? `${row.author} · ` : ""}
                        {new Date(row.importedAt).toLocaleString()} ·{" "}
                        {packCountsText(d, row.counts)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {row.allGone ? (
                        <span className="text-[11px] text-ink-3">{p.importedGone}</span>
                      ) : row.documentIds.length > 0 ? (
                        // ⚠️ 只在**确实有**存活的资料 id 时才给跳转按钮 —— 异常记录
                        //    （`documentIds` 为空，`allGone` 判据刻意不覆盖）不该产生
                        //    `/learn/doc/undefined` 这种死链接。
                        <button
                          type="button"
                          data-testid={`settings-pack-open-${row.contentHash}`}
                          onClick={() => navigate(`/learn/doc/${row.documentIds[0]}`)}
                          className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
                        >
                          {p.importedOpen}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        data-testid={`settings-pack-remove-${row.contentHash}`}
                        disabled={!!busy}
                        onClick={() => void removeRecord(row.contentHash)}
                        className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-50"
                      >
                        {p.importedRemove}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {/* 明文提醒：包会带上署名与许可声明，确认选中的资料可以分享。 */}
      <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">
        {p.notice}
      </p>

      {error ? (
        <p data-testid="settings-pack-error" className="text-xs text-ink-2">
          • {errorText(error.kind, p)}
        </p>
      ) : null}
    </Card>
  );
}


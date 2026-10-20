import { Card } from "../../../components/primitives";
import type { Messages } from "../../../i18n";
import { storagePlacementOf } from "../../../lib/storage-label";
import { storage } from "../../../stores/useLoopStore";
import DataPortabilityCard from "../../data/portability/DataPortabilityCard";
import KnowledgePackCard, { type PackCandidate } from "../../data/portability/KnowledgePackCard";
import { SectionShell } from "../SectionShell";

/** Storage 分区数据规模快照。 */
export interface StorageCounts {
  docs: number;
  chapters: number;
  papers: number;
  goals: number;
  evidence: number;
}

/** 保存位置文案：`storagePlacementOf` 只给 enum，文案在此映射。 */
function placementLabelOf(name: string, sg: Messages["settings"]["storage"]): string {
  return storagePlacementOf(name) === "temporary" ? sg.storageMemory : sg.storageLocal;
}

export default function StorageSection({
  counts,
  packCandidates,
  st,
  loading,
  onDataChanged,
}: {
  counts: StorageCounts | undefined;
  /** 可打包资料（与 `counts` 同源；未就绪 = `undefined`）。 */
  packCandidates: PackCandidate[] | undefined;
  st: Messages["settings"];
  loading: string;
  /** 导入换掉整库后通知父级重算计数（数据可携带卡 / 知识包卡共用）。 */
  onDataChanged: () => void;
}) {
  const sg = st.storage;
  return (
    <SectionShell title={sg.title} desc={sg.desc}>
      <Card className="space-y-3">
        <dl className="space-y-1.5 text-sm">
          <KV k={sg.backend} v={placementLabelOf(storage.name, sg)} />
        </dl>
        <div className="border-t border-line pt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{sg.counts}</p>
          {counts ? (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <StatCell label={sg.docCount(counts.docs)} />
              <StatCell label={sg.chapterCount(counts.chapters)} />
              <StatCell label={sg.paperCount(counts.papers)} />
              <StatCell label={sg.goalCount(counts.goals)} />
              <StatCell label={sg.evidenceCount(counts.evidence)} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-3">{loading}</p>
          )}
        </div>
        <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">{sg.note}</p>
      </Card>
      {/* 数据可携带（F4）：导出 / 导入 / 单章 Markdown。同屏有「我这库有多大」的语境。 */}
      <div className="mt-3">
        <DataPortabilityCard counts={counts} onDataChanged={onDataChanged} />
      </div>
      {/* 社区知识包（F10）：把选中资料打成一份可分享的 .ploskp.json，或导入别人的包。 */}
      <div className="mt-3">
        <KnowledgePackCard docs={packCandidates} onDataChanged={onDataChanged} />
      </div>
    </SectionShell>
  );
}

function StatCell({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-line bg-subtle/60 px-2.5 py-2 text-center">
      <p className="truncate text-xs text-ink-2">{label}</p>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-3">{k}</dt>
      <dd className="truncate text-ink-1">{v}</dd>
    </div>
  );
}

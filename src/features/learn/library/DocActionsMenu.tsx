/**
 * 资料卡操作菜单（卡片右上「⋯」；docs/library-module-design-2026-09.md §8.12）。
 * 与列表页/详情页共用：动作种类由 DocActionKind 统一，弹窗编排归页面。
 */
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { useI18n } from "../../../i18n";

export type DocActionKind =
  | "rename"
  | "meta"
  | "replace"
  | "append"
  | "split"
  | "resplit"
  | "delete";

export default function DocActionsMenu({
  docId,
  unsplit,
  hasBody,
  onAction,
}: {
  docId: string;
  /** 未切分（0 章）→ 菜单含「立即切分」，否则「重新切分」。 */
  unsplit: boolean;
  /** 有正文才允许替换/追加/切分。 */
  hasBody: boolean;
  onAction: (kind: DocActionKind) => void;
}) {
  const { m } = useI18n();
  const a = m.learn.library.actions;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={m.common.more}
        data-testid={`doc-menu-${docId}`}
        className="absolute right-3 top-3 rounded-md p-1 text-ink-3 opacity-0 transition group-hover:opacity-100 data-open:opacity-100 hover:bg-subtle hover:text-ink-1 focus-visible:opacity-100 focus-visible:outline-none"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onAction("rename")} data-testid={`doc-menu-rename-${docId}`}>
          {a.rename}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("meta")} data-testid={`doc-menu-meta-${docId}`}>
          {a.meta}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!hasBody}
          onClick={() => onAction("replace")}
          data-testid={`doc-menu-replace-${docId}`}
        >
          {a.replace}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasBody}
          onClick={() => onAction("append")}
          data-testid={`doc-menu-append-${docId}`}
        >
          {a.append}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasBody}
          onClick={() => onAction(unsplit ? "split" : "resplit")}
          data-testid={`doc-menu-split-${docId}`}
        >
          {unsplit ? a.split : a.resplit}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onClick={() => onAction("delete")}
          data-testid={`doc-menu-delete-${docId}`}
        >
          {a.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

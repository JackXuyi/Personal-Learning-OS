import * as React from "react";
import { Button } from "./button";
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogRoot,
  AlertDialogTitle,
} from "./alert-dialog";

/**
 * ConfirmDialog（UI Kit；AlertDialog 便捷封装，M2 落地）。
 * 消灭 window.confirm 的受控替代：无 i18n（文案由调用方传），
 * 取消/确认均为显式按钮（AlertDialog 无 Esc/遮罩关闭语义）。
 */
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 确认按钮文案（如「删除」「退出」） */
  confirmLabel: React.ReactNode;
  /** 取消按钮文案，默认「取消」由调用方给 i18n 词 */
  cancelLabel?: React.ReactNode;
  /** 危险操作（红色确认） */
  destructive?: boolean;
  onConfirm: () => void;
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const close = () => onOpenChange(false);
  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-semibold text-ink-1">
            {title}
          </AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className="text-sm leading-relaxed text-ink-2">
              {description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              close();
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}

export { ConfirmDialog };
export type { ConfirmDialogProps };

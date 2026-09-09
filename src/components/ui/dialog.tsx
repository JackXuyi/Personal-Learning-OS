import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Dialog（UI Kit；Base UI 底层，M2 落地，docs 方案 §6.3）。
 * 用法（受控）：
 *   <Dialog.Root open={open} onOpenChange={setOpen}>
 *     <Dialog.Content>
 *       <Dialog.Header><Dialog.Title/><Dialog.Description/></Dialog.Header>
 *       …内容…
 *       <Dialog.Footer>…按钮…</Dialog.Footer>
 *     </Dialog.Content>
 *   </Dialog.Root>
 * 关闭方式：Esc / 点遮罩 / 右上 × / 调用方按钮置 onOpenChange(false)。
 */

/** 遮罩基础样式（alert-dialog 复用） */
export const overlayBase =
  "fixed inset-0 z-40 bg-ink-1/40 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0";

/** 浮层基础样式（alert-dialog 复用）：transitions 走 Base UI data-*-style 动画 */
export const contentBase =
  "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-6 text-ink-1 shadow-xl outline-none transition-[opacity,scale] duration-150 data-starting-style:scale-[0.96] data-starting-style:opacity-0 data-ending-style:scale-[0.96] data-ending-style:opacity-0";

const DialogRoot = BaseDialog.Root;
const DialogTrigger = BaseDialog.Trigger;
const DialogTitle = BaseDialog.Title;
const DialogDescription = BaseDialog.Description;

type DialogContentProps = React.ComponentProps<typeof BaseDialog.Popup> & {
  /** 显示右上关闭按钮（默认 true） */
  showClose?: boolean;
};

function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={overlayBase} />
      <BaseDialog.Popup
        data-slot="dialog-content"
        className={cn(contentBase, className)}
        {...props}
      >
        {children}
        {showClose ? (
          <BaseDialog.Close
            aria-label="Close"
            className="absolute right-4 top-4 rounded-md p-1 text-ink-3 transition-colors hover:bg-subtle hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <X className="size-4" aria-hidden />
          </BaseDialog.Close>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-6", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

const Dialog = Object.assign(BaseDialog, {});
export { Dialog, DialogRoot, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };

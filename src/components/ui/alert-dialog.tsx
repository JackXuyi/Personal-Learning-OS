import * as React from "react";
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { cn } from "../../lib/utils";
import { contentBase, overlayBase } from "./dialog";

/**
 * AlertDialog（UI Kit；Base UI 底层，M2 落地）。
 * 语义：必须显式确认/取消（无 Esc / 遮罩关闭，dismissible=false）。
 * 用法（受控，按钮走调用方）：
 *   <AlertDialog.Root open onOpenChange>
 *     <AlertDialog.Content>
 *       <AlertDialog.Header><AlertDialog.Title/>…</AlertDialog.Header>
 *       <AlertDialog.Footer>
 *         <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
 *         <Button variant="destructive" onClick={…}>删除</Button>
 *       </AlertDialog.Footer>
 *     </AlertDialog.Content>
 *   </AlertDialog.Root>
 * 高频场景直接用 confirm-dialog。
 */

const AlertDialogRoot = BaseAlertDialog.Root;
const AlertDialogTitle = BaseAlertDialog.Title;
const AlertDialogDescription = BaseAlertDialog.Description;

function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseAlertDialog.Popup>) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop className={overlayBase} />
      <BaseAlertDialog.Popup
        data-slot="alert-dialog-content"
        className={cn(contentBase, className)}
        {...props}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
};

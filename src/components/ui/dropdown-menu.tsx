import * as React from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cn } from "../../lib/utils";

/**
 * DropdownMenu（UI Kit；Base UI 底层，资料卡「⋯」操作菜单用，docs §8.9）。
 * 用法（受控或非受控均可）：
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild><button>⋯</button></DropdownMenuTrigger>
 *     <DropdownMenuContent>
 *       <DropdownMenuItem onClick={…}>重命名</DropdownMenuItem>
 *       <DropdownMenuSeparator />
 *       <DropdownMenuItem destructive onClick={…}>删除</DropdownMenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 */

const DropdownMenuRoot = BaseMenu.Root;
const DropdownMenuTrigger = BaseMenu.Trigger;

type MenuContentProps = React.ComponentProps<typeof BaseMenu.Popup>;

function DropdownMenuContent({ className, sideOffset = 4, ...props }: MenuContentProps & { sideOffset?: number }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner sideOffset={sideOffset} align="end">
        <BaseMenu.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "z-50 min-w-[9rem] overflow-hidden rounded-md border border-line bg-surface p-1 text-ink-1 shadow-lg outline-none",
            "transition-[opacity,scale] duration-100 data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:opacity-0",
            className,
          )}
          {...props}
        />
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

type MenuItemProps = React.ComponentProps<typeof BaseMenu.Item> & {
  /** 危险操作（删除）——红色文字。 */
  destructive?: boolean;
};

function DropdownMenuItem({ className, destructive = false, ...props }: MenuItemProps) {
  return (
    <BaseMenu.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
        "data-highlighted:bg-subtle data-highlighted:text-ink-1",
        destructive
          ? "text-destructive data-highlighted:text-destructive"
          : "text-ink-2 data-highlighted:text-ink-1",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-line", className)}
      {...props}
    />
  );
}

const DropdownMenu = DropdownMenuRoot;
export {
  DropdownMenu,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
};

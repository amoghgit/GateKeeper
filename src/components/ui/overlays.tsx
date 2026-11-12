"use client";

/**
 * Radix-based interactive primitives: Dialog, Sheet, DropdownMenu, Tabs,
 * Switch, Checkbox, Tooltip.
 */
import { Check, X } from "lucide-react";
import {
  Checkbox as CheckboxPrimitive,
  Dialog as DialogPrimitive,
  DropdownMenu as MenuPrimitive,
  Switch as SwitchPrimitive,
  Tabs as TabsPrimitive,
} from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

// ───────────────────────────── Dialog ─────────────────────────────

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  size = "md",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { size?: "sm" | "md" | "lg" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="bg-navy/30 data-[state=open]:animate-fade-in fixed inset-0 z-50 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "border-border bg-surface data-[state=open]:animate-slide-up fixed top-1/2 left-1/2 z-50 flex max-h-[min(90vh,820px)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border shadow-[var(--shadow-raised)]",
          size === "sm" && "max-w-md",
          size === "md" && "max-w-lg",
          size === "lg" && "max-w-2xl",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="text-muted-foreground hover:bg-surface-muted hover:text-foreground absolute top-4 right-4 rounded-md p-1 transition-colors"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("border-border space-y-1 border-b px-6 pt-5 pr-12 pb-4", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-base font-semibold tracking-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-muted-foreground text-[13px]", className)} {...props} />;
}

export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex-1 overflow-y-auto px-6 py-5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("border-border bg-surface-muted/40 flex flex-col-reverse gap-2 border-t px-6 py-3.5 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

// ───────────────────────────── Sheet (mobile nav) ─────────────────────────────

export function SheetContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="bg-navy/30 data-[state=open]:animate-fade-in fixed inset-0 z-50" />
      <DialogPrimitive.Content
        className={cn(
          "bg-surface data-[state=open]:animate-fade-in fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col shadow-[var(--shadow-raised)]",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ───────────────────────────── Dropdown menu ─────────────────────────────

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({ className, align = "end", sideOffset = 6, ...props }: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "border-border bg-surface data-[state=open]:animate-fade-in z-50 min-w-48 rounded-xl border p-1 shadow-[var(--shadow-raised)]",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "text-ink-soft data-[highlighted]:bg-surface-muted data-[highlighted]:text-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("text-muted-foreground px-2.5 py-2 text-xs", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("bg-border my-1 h-px", className)} {...props} />;
}

// ───────────────────────────── Tabs ─────────────────────────────

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List className={cn("border-border bg-surface-muted/70 inline-flex h-10 items-center gap-1 rounded-lg border p-1", className)} {...props} />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "text-muted-foreground hover:text-foreground data-[state=active]:bg-surface data-[state=active]:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors data-[state=active]:shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

// ───────────────────────────── Switch & Checkbox ─────────────────────────────

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "bg-border-strong data-[state=checked]:bg-primary inline-flex h-5.5 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4.5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[19px]" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "border-border-strong bg-surface data-[state=checked]:border-primary data-[state=checked]:bg-primary flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border shadow-[var(--shadow-card)] transition-colors data-[state=checked]:text-white",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

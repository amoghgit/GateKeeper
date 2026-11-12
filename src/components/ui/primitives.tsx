/**
 * Small presentational primitives: Card, Badge, Input, Label, Textarea,
 * NativeSelect, Skeleton, Separator, Table.
 */
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import { Label as LabelPrimitive, Separator as SeparatorPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

// ───────────────────────────── Card ─────────────────────────────

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("border-border bg-surface rounded-xl border shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-1 sm:px-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-foreground text-[15px] font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-muted-foreground mt-0.5 text-[13px]", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 py-4 sm:px-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("border-border flex items-center gap-2 border-t px-5 py-3 sm:px-6", className)} {...props} />;
}

// ───────────────────────────── Badge ─────────────────────────────

const badgeVariants = cva("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-neutral-soft text-ink-soft",
      primary: "bg-primary-soft text-primary",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      danger: "bg-danger-soft text-danger",
      info: "bg-info-soft text-info",
      dark: "bg-navy text-white",
      outline: "border border-border bg-surface text-ink-soft",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, dot, children, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

// ───────────────────────────── Form fields ─────────────────────────────

const fieldBase =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-[var(--shadow-card)] transition-colors placeholder:text-muted-foreground/70 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 aria-invalid:border-danger aria-invalid:ring-danger/15";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldBase, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldBase, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />;
}

export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select data-slot="select" className={cn(fieldBase, "h-10 appearance-none pr-9")} {...props}>
        {children}
      </select>
      <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" aria-hidden />
    </div>
  );
}

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-foreground text-[13px] font-medium", className)} {...props} />;
}

/** Label + control + hint/error, wired with ids for accessibility. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
  optional,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  className?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional && <span className="text-muted-foreground ml-1 font-normal">(optional)</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Misc ─────────────────────────────

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("bg-surface-muted animate-pulse rounded-md", className)} {...props} />;
}

export function Separator({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn("bg-border shrink-0", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return <kbd className={cn("border-border bg-surface-muted text-ink-soft rounded border px-1.5 py-0.5 font-mono text-[11px]", className)} {...props} />;
}

// ───────────────────────────── Table ─────────────────────────────

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-border bg-surface-muted/60 border-b", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-border divide-y", className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-surface-muted/50 transition-colors", className)} {...props} />;
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "text-muted-foreground h-10 px-4 text-left align-middle text-xs font-medium tracking-wide whitespace-nowrap uppercase first:pl-5 last:pr-5",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("text-ink-soft px-4 py-3 align-middle first:pl-5 last:pr-5", className)} {...props} />;
}

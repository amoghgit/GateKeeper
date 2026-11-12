import Link from "next/link";
import { cn } from "@/lib/utils";

/** The GateKeeper mark: a gate arch with a verified keyhole. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--navy)" />
      <path d="M9 24V14.5a7 7 0 0 1 14 0V24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6.5 24h19" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="15.5" r="2.4" fill="var(--primary)" stroke="#5eead4" strokeWidth="0.8" />
      <path d="M16 17.6v3.4" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, href = "/", tone = "dark" }: { className?: string; href?: string; tone?: "dark" | "light" }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 rounded-md", className)} aria-label="GateKeeper home">
      <LogoMark />
      <span className={cn("text-[17px] font-semibold tracking-tight", tone === "dark" ? "text-foreground" : "text-white")}>
        Gate<span className="text-primary">Keeper</span>
      </span>
    </Link>
  );
}

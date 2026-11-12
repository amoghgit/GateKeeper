"use client";

import { QRCodeSVG } from "qrcode.react";
import { Bell, CircleCheck, DoorOpen, LogIn, QrCode, ScanLine, Users } from "lucide-react";
import { LogoMark } from "@/components/shared/brand";
import { cn } from "@/lib/utils";

/** Static, illustrative product mock for the marketing page (no live data). */

const bars = [32, 44, 38, 52, 47, 61, 58, 66, 54, 72, 69, 80, 74, 88];

export function HeroPreview() {
  return (
    <div className="relative">
      <div className="border-border bg-surface overflow-hidden rounded-2xl border shadow-[0_40px_80px_-30px_rgba(13,27,42,0.35)]">
        <div className="border-border bg-surface-muted/70 flex items-center gap-2 border-b px-4 py-2.5">
          <span className="bg-border-strong size-2.5 rounded-full" />
          <span className="bg-border-strong size-2.5 rounded-full" />
          <span className="bg-border-strong size-2.5 rounded-full" />
          <span className="bg-surface text-muted-foreground ml-3 rounded-md px-3 py-0.5 text-[11px]">gatekeeper.app/admin/dashboard</span>
        </div>
        <div className="grid grid-cols-[150px_1fr] max-sm:grid-cols-1">
          <aside className="border-border border-r p-3 max-sm:hidden">
            <div className="mb-4 flex items-center gap-2 px-1">
              <LogoMark className="size-6" />
              <span className="text-[13px] font-semibold">GateKeeper</span>
            </div>
            {["Overview", "Analytics", "Visitors", "Residents", "Security"].map((l, i) => (
              <div
                key={l}
                className={cn("mb-0.5 rounded-md px-2 py-1.5 text-[11px]", i === 0 ? "bg-primary-soft text-primary font-medium" : "text-muted-foreground")}
              >
                {l}
              </div>
            ))}
          </aside>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: "Inside now", v: "12", i: DoorOpen },
                { l: "Entries today", v: "86", i: LogIn },
                { l: "Residents", v: "412", i: Users },
              ].map((s) => (
                <div key={s.l} className="border-border rounded-lg border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-[10px]">{s.l}</span>
                    <s.i className="text-primary size-3" />
                  </div>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{s.v}</p>
                </div>
              ))}
            </div>
            <div className="border-border rounded-lg border p-3">
              <p className="mb-2 text-[11px] font-medium">Daily visitor traffic</p>
              <div className="flex h-24 items-end gap-1">
                {bars.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-[3px] bg-[var(--chart-entries)]"
                    style={{ height: `${h}%`, opacity: 0.35 + (i / bars.length) * 0.65 }}
                  />
                ))}
              </div>
            </div>
            <div className="border-border space-y-1.5 rounded-lg border p-3">
              {[
                ["Rahul Verma", "Tower A · 1204", "Inside"],
                ["Swiggy delivery", "Tower B · 605", "Pending"],
                ["Lakshmi Devi", "Villa 02", "Inside"],
              ].map(([n, a, s]) => (
                <div key={n} className="flex items-center justify-between text-[11px]">
                  <span>
                    <span className="font-medium">{n}</span> <span className="text-muted-foreground">· {a}</span>
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-px text-[10px] font-medium",
                      s === "Inside" ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
                    )}
                  >
                    {s}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="border-border bg-surface absolute -bottom-10 -left-10 w-52 rounded-2xl border p-4 shadow-[var(--shadow-raised)] max-md:hidden">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold">Entry pass</span>
          <span className="text-primary font-mono text-[11px]">K7Q-4MX</span>
        </div>
        <div className="border-border flex justify-center rounded-lg border bg-white p-3" aria-hidden>
          <QRCodeSVG value="GateKeeper sample pass — illustration only" size={150} level="M" marginSize={0} fgColor="#0d1b2a" />
        </div>
        <p className="text-success mt-3 flex items-center gap-1.5 text-[11px]">
          <CircleCheck className="size-3.5" /> Verified at Main Gate
        </p>
      </div>
      <div className="border-border bg-surface absolute -top-5 -right-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-[var(--shadow-raised)] max-md:hidden">
        <span className="bg-primary-soft text-primary flex size-7 items-center justify-center rounded-lg">
          <Bell className="size-3.5" />
        </span>
        <span className="text-[11px]">
          <span className="block font-medium">Rahul entered</span>
          <span className="text-muted-foreground">Checked in by Ravi · just now</span>
        </span>
      </div>
    </div>
  );
}

export function RolePreview({ role }: { role: "resident" | "security" | "admin" }) {
  if (role === "security") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-navy relative flex aspect-[4/3] items-center justify-center rounded-xl">
          <div className="size-36 rounded-2xl border-2 border-white/80" />
          <ScanLine className="absolute size-8 text-teal-300" />
        </div>
        <div className="border-success/40 rounded-xl border">
          <div className="bg-success-soft text-success flex items-center gap-2 rounded-t-xl px-4 py-3 text-sm font-semibold">
            <CircleCheck className="size-4" /> Pass verified
          </div>
          <div className="space-y-2 p-4 text-[13px]">
            <p className="text-base font-semibold">Rahul Verma</p>
            <p className="text-muted-foreground">Visiting Tower A · 1204 — Ananya Sharma</p>
            <p className="text-muted-foreground">Valid today 18:00 – 23:30 · Single use</p>
            <div className="bg-primary mt-3 rounded-lg py-2 text-center text-[13px] font-medium text-white">Record entry</div>
          </div>
        </div>
      </div>
    );
  }
  if (role === "resident") {
    return (
      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="border-border rounded-xl border p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <QrCode className="text-primary size-4" /> Invite a visitor
          </p>
          {["Visitor name", "Phone", "Arrival", "Departure"].map((f) => (
            <div key={f} className="mb-2">
              <p className="text-muted-foreground mb-1 text-[11px]">{f}</p>
              <div className="border-border h-8 rounded-md border" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="border-warning/40 bg-warning-soft/50 rounded-xl border p-4">
            <p className="text-sm font-semibold">Visitor waiting at the gate</p>
            <p className="text-muted-foreground text-[13px]">Imran Khan · Swiggy order</p>
            <div className="mt-3 flex gap-2">
              <span className="bg-primary rounded-md px-3 py-1.5 text-[12px] font-medium text-white">Approve</span>
              <span className="border-border bg-surface rounded-md border px-3 py-1.5 text-[12px] font-medium">Reject</span>
            </div>
          </div>
          <div className="border-border rounded-xl border p-4 text-[13px]">
            <p className="font-semibold">Upcoming</p>
            <p className="text-muted-foreground mt-2">Today 19:00 · Rahul Verma · Guest</p>
            <p className="text-muted-foreground">Tomorrow 11:00 · Meera Kapoor · Guest</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[
        ["Visitors this month", "2,148"],
        ["Entries today", "86"],
        ["Denied entries", "23"],
      ].map(([l, v]) => (
        <div key={l} className="border-border rounded-xl border p-4">
          <p className="text-muted-foreground text-[13px]">{l}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
        </div>
      ))}
      <div className="border-border rounded-xl border p-4 md:col-span-3">
        <p className="mb-3 text-[13px] font-medium">Weekly trends</p>
        <div className="flex h-28 items-end gap-3">
          {[48, 62, 55, 70, 66, 82, 90, 76].map((h, i) => (
            <div key={i} className="flex flex-1 items-end gap-0.5">
              <div className="flex-1 rounded-t-[3px] bg-[var(--chart-entries)]" style={{ height: `${h}%` }} />
              <div className="flex-1 rounded-t-[3px] bg-[var(--chart-exits)]" style={{ height: `${h - 6}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

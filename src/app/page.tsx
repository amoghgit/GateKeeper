import {
  Activity,
  ArrowRight,
  BellRing,
  ChartColumn,
  ClipboardList,
  Cloud,
  DoorOpen,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  QrCode,
  ScanLine,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Timer,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { HeroPreview } from "@/components/marketing/product-preview";
import { RoleTabs } from "@/components/marketing/role-tabs";
import { Logo } from "@/components/shared/brand";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: QrCode,
    title: "Secure QR passes",
    body: "Single-use or recurring passes carrying only an opaque 256-bit token — never a name, phone or flat number.",
  },
  { icon: ScanLine, title: "Gate-speed verification", body: "Guards scan with any phone or tablet camera. Validity, approval and identity in one screen." },
  { icon: BellRing, title: "Real-time approvals", body: "Walk-in at the gate? The resident approves or rejects from their phone before anyone enters." },
  { icon: DoorOpen, title: "Live occupancy", body: "Always know who is inside, since when, and who let them in — with overstays flagged automatically." },
  { icon: ChartColumn, title: "Traffic analytics", body: "Daily, weekly and monthly trends, category mix and denied attempts for the association." },
  { icon: ScrollText, title: "Tamper-evident audit", body: "A hash-chained log of every critical action that can be verified end-to-end in one click." },
];

const STEPS = [
  { icon: UserPlus, title: "Resident invites", body: "Enter the visitor's name, phone and time. GateKeeper issues a time-boxed QR pass to share." },
  { icon: ScanLine, title: "Guard verifies", body: "The QR is scanned at the gate and checked server-side for validity, approval and prior use." },
  { icon: ClipboardList, title: "Every move recorded", body: "Entry and exit are logged atomically, the resident is notified, and analytics update." },
];

const SECURITY = [
  { icon: LockKeyhole, title: "Tenant isolation", body: "Every record is partitioned by community; identity comes from verified tokens, never the browser." },
  { icon: Fingerprint, title: "Atomic gate writes", body: "Conditional writes make duplicate entries impossible — even with two guards scanning at once." },
  {
    icon: KeyRound,
    title: "Hashed, revocable passes",
    body: "Tokens are stored as keyed hashes and can be regenerated instantly if a pass is shared too widely.",
  },
  { icon: ShieldCheck, title: "Role-based access", body: "Residents see their apartment, guards their gate, administrators their community. Nothing more." },
];

export default function LandingPage() {
  return (
    <div className="bg-surface flex flex-1 flex-col">
      <header className="border-border/70 bg-surface/85 sticky top-0 z-40 border-b backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5" aria-label="Primary">
          <Logo />
          <div className="text-ink-soft hidden flex-1 items-center gap-7 text-[13.5px] md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#security" className="hover:text-foreground">
              Security
            </a>
            <a href="#product" className="hover:text-foreground">
              Product
            </a>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Get started</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(60%_60%_at_70%_0%,var(--primary-softer),transparent)]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pt-16 pb-24 lg:grid-cols-[1fr_1.1fr] lg:pt-24">
            <div>
              <p className="border-border bg-surface text-ink-soft mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
                <span className="bg-primary size-1.5 rounded-full" /> Visitor management for residential communities
              </p>
              <h1 className="text-foreground text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[3.25rem]">
                Every visitor, verified.
                <span className="text-muted-foreground block">No registers. No guesswork.</span>
              </h1>
              <p className="text-ink-soft mt-6 max-w-lg text-[17px] leading-relaxed">
                GateKeeper replaces the paper register and the intercom call with secure digital passes, instant resident approvals and a complete, auditable
                record of who came and went.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" asChild>
                  <Link href="/login">
                    Try the live demo <ArrowRight />
                  </Link>
                </Button>
                <Button size="lg" variant="secondary" asChild>
                  <a href="#how">See how it works</a>
                </Button>
              </div>
              <dl className="border-border mt-10 grid max-w-md grid-cols-3 gap-6 border-t pt-6">
                {[
                  ["256-bit", "random pass tokens"],
                  ["0", "personal data in QR"],
                  ["100%", "entries audited"],
                ].map(([v, l]) => (
                  <div key={l}>
                    <dt className="text-xl font-semibold tracking-tight">{v}</dt>
                    <dd className="text-muted-foreground text-xs">{l}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <HeroPreview />
          </div>
        </section>

        <section className="border-border bg-background border-y py-20" id="features">
          <div className="mx-auto max-w-6xl px-5">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-primary text-xs font-semibold tracking-wider uppercase">Product</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">One system for the gate, the residents and the office</h2>
              <p className="text-muted-foreground mt-4">
                Manual registers create security gaps, slow entry and leave no reliable record. GateKeeper digitises the whole visitor journey — from invitation
                to exit.
              </p>
            </div>
            <div className="border-border bg-border mt-14 grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="bg-surface p-7">
                  <span className="bg-primary-softer text-primary flex size-10 items-center justify-center rounded-xl">
                    <f.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-5 text-[15px] font-semibold">{f.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20" id="how">
          <div className="mx-auto max-w-6xl px-5">
            <div className="max-w-xl">
              <p className="text-primary text-xs font-semibold tracking-wider uppercase">How it works</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">From invitation to exit in three steps</h2>
            </div>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="border-border relative rounded-2xl border p-7">
                  <span className="text-muted-foreground font-mono text-xs">0{i + 1}</span>
                  <s.icon className="text-primary mt-4 size-6" aria-hidden />
                  <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-navy py-20 text-white" id="security">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-[1fr_1.3fr]">
            <div>
              <p className="text-xs font-semibold tracking-wider text-teal-300 uppercase">Security</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Built like it guards something important. Because it does.</h2>
              <p className="mt-4 text-white/65">
                GateKeeper runs on a serverless AWS architecture — Cognito, API Gateway, Lambda and DynamoDB — with least-privilege permissions, encryption at
                rest and an append-only audit trail.
              </p>
              <div className="mt-8 flex flex-wrap gap-3 text-xs text-white/70">
                {[
                  [Cloud, "AWS serverless"],
                  [ServerCog, "Infrastructure as code"],
                  [Activity, "CloudWatch monitored"],
                  [Timer, "Automated expiry"],
                ].map(([Icon, l]) => {
                  const I = Icon as typeof Cloud;
                  return (
                    <span key={l as string} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1">
                      <I className="size-3.5" /> {l as string}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {SECURITY.map((s) => (
                <div key={s.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                  <s.icon className="size-5 text-teal-300" aria-hidden />
                  <h3 className="mt-4 text-[15px] font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20" id="product">
          <div className="mx-auto max-w-5xl px-5">
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <p className="text-primary text-xs font-semibold tracking-wider uppercase">Dashboards</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Designed for each person at the gate</h2>
            </div>
            <RoleTabs />
          </div>
        </section>

        <section className="px-5 pb-24">
          <div className="bg-primary mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 rounded-3xl px-8 py-12 text-white sm:px-12 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Bring your community&apos;s gate online.</h2>
              <p className="mt-2 text-white/80">Explore the full product with seeded demo accounts — no setup needed.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" className="text-primary bg-white hover:bg-white/90" asChild>
                <Link href="/login">Open the demo</Link>
              </Button>
              <Button size="lg" className="border border-white/30 bg-transparent hover:bg-white/10" asChild>
                <Link href="/register">Register as a resident</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-border border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="hidden md:inline">Visitor management for residential communities.</span>
          </div>
          <div className="flex gap-6">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#security" className="hover:text-foreground">
              Security
            </a>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
          </div>
          <p>© {new Date().getFullYear()} GateKeeper</p>
        </div>
      </footer>
    </div>
  );
}

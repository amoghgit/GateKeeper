import { BadgeCheck, LockKeyhole, ScanLine } from "lucide-react";
import { Logo } from "@/components/shared/brand";

const POINTS = [
  { icon: ScanLine, title: "Verified at the gate", body: "Every visitor carries a one-time QR pass checked against the resident's approval." },
  { icon: LockKeyhole, title: "Private by design", body: "Passes contain an opaque token — never names, phone numbers or flat numbers." },
  { icon: BadgeCheck, title: "Accountable records", body: "A tamper-evident audit trail of every entry, exit and decision." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="bg-navy relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }}
        />
        <Logo tone="light" className="relative" />
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">The front gate, finally in sync with the people behind it.</h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-teal-300">
                  <p.icon className="size-4.5" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{p.title}</span>
                  <span className="mt-0.5 block text-sm text-white/65">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/45">© {new Date().getFullYear()} GateKeeper. Built for residential communities.</p>
      </section>
      <section className="flex flex-col px-5 py-8 sm:px-10">
        <Logo className="mb-10 lg:hidden" />
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center">{children}</div>
      </section>
    </div>
  );
}

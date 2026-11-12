import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/shared/providers";
import { isDemoDisplay } from "@/server/display-mode";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "GateKeeper — Visitor management for residential communities", template: "%s · GateKeeper" },
  description: "Digital visitor passes, QR verification at the gate, and a complete, auditable entry log for apartment communities.",
};

export const viewport: Viewport = {
  themeColor: "#0d1b2a",
  width: "device-width",
  initialScale: 1,
};

async function DemoBanner() {
  if (!(await isDemoDisplay())) return null;
  return (
    <div role="note" className="bg-navy relative z-40 flex items-center justify-center gap-2 px-4 py-1.5 text-center text-[12px] text-white/85">
      <span className="text-navy rounded bg-amber-400/90 px-1.5 py-px text-[10px] font-semibold tracking-wider uppercase">Local demo</span>
      <span>Simulated data stored on this machine. No AWS services are called and no real messages are sent.</span>
    </div>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <DemoBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

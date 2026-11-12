"use client";

import { ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore } from "react";
import { Logo } from "@/components/shared/brand";
import { Card } from "@/components/ui/primitives";

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

/**
 * Visitor-facing pass. The token arrives in the URL fragment, which browsers
 * never send to a server — this page renders the QR entirely on-device and
 * makes no API calls.
 */
export default function PassPage() {
  const payload = useSyncExternalStore(
    subscribe,
    () => decodeURIComponent(window.location.hash.slice(1)),
    () => "",
  );
  const valid = /^GK1\.[A-Za-z0-9_-]{43}$/.test(payload);
  return (
    <div className="bg-background flex flex-1 flex-col items-center justify-center px-5 py-12">
      <Logo className="mb-8" />
      <Card className="w-full max-w-sm overflow-hidden text-center">
        <div className="bg-navy px-6 py-4 text-white">
          <p className="text-sm font-semibold">Your entry pass</p>
          <p className="text-xs text-white/60">Show this QR code to security at the gate</p>
        </div>
        <div className="flex flex-col items-center gap-5 p-8">
          {valid ? (
            <div className="border-border rounded-2xl border bg-white p-4">
              <QRCodeSVG value={payload} size={232} level="M" marginSize={0} fgColor="#0d1b2a" title="GateKeeper entry pass" />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">This pass link is incomplete. Ask your host to share it again.</p>
          )}
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <ShieldCheck className="text-primary size-4" /> Contains no personal information
          </p>
        </div>
      </Card>
    </div>
  );
}

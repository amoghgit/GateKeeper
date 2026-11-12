"use client";

import { CalendarClock, Copy, Download, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useRef } from "react";
import { toast } from "sonner";
import { CATEGORY_LABELS } from "@/shared/domain";
import type { Invitation } from "@/shared/types";
import { StatusBadge } from "@/components/shared/badges";
import { LogoMark } from "@/components/shared/brand";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

/** Link a visitor can open on their phone. The token stays in the URL fragment, which browsers never send to servers. */
export function passLink(payload: string) {
  return `${window.location.origin}/pass#${payload}`;
}

export function shareText(inv: Invitation, payload: string) {
  return [
    `Hi ${inv.visitor.fullName.split(" ")[0]}, here is your GateKeeper entry pass for ${inv.apartmentLabel}.`,
    `Valid ${formatDateTime(inv.validFrom)} – ${formatDateTime(inv.expiry)}.`,
    `Show this QR at the gate: ${passLink(payload)}`,
    `Gate code: ${inv.code}`,
  ].join("\n");
}

export function QrPass({ invitation, payload }: { invitation: Invitation; payload: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText(invitation, payload));
      toast.success("Pass details copied");
    } catch {
      toast.error("Copy failed — your browser blocked clipboard access.");
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "GateKeeper entry pass", text: shareText(invitation, payload) });
      } catch {
        /* user dismissed the share sheet */
      }
    } else {
      await copy();
    }
  };

  const download = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 720;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 720, 720);
      ctx.drawImage(img, 40, 40, 640, 640);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `gatekeeper-pass-${invitation.code}.png`;
      a.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  };

  return (
    <div className="border-border bg-surface overflow-hidden rounded-2xl border">
      <div className="bg-navy flex items-center justify-between px-5 py-3 text-white">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <LogoMark className="size-6" /> Entry pass
        </span>
        <span className="font-mono text-sm tracking-widest text-teal-300" data-testid="pass-code">
          {invitation.code}
        </span>
      </div>
      <div className="flex flex-col items-center gap-5 p-6 sm:flex-row sm:items-start">
        <div className="border-border rounded-xl border bg-white p-3" data-testid="qr-code" data-payload={payload}>
          <QRCodeSVG ref={svgRef} value={payload} size={176} level="M" marginSize={0} fgColor="#0d1b2a" title={`QR pass ${invitation.code}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
          <div>
            <p className="text-lg font-semibold tracking-tight">{invitation.visitor.fullName}</p>
            <p className="text-muted-foreground text-[13px]">
              {CATEGORY_LABELS[invitation.visitor.category]} · {invitation.apartmentLabel}
            </p>
          </div>
          <StatusBadge status={invitation.status} />
          <div className="text-ink-soft flex items-start justify-center gap-2 text-[13px] sm:justify-start">
            <CalendarClock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span>
              Valid {formatDateTime(invitation.validFrom)} – {formatDateTime(invitation.expiry)}
              <span className="text-muted-foreground block text-xs">
                {invitation.usagePolicy === "MULTI_USE" ? "Recurring pass · multiple entries" : "Single use"}
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="border-border grid grid-cols-3 border-t">
        <Button variant="ghost" className="rounded-none" onClick={share}>
          <Share2 /> Share
        </Button>
        <Button variant="ghost" className="border-border rounded-none border-x" onClick={copy}>
          <Copy /> Copy
        </Button>
        <Button variant="ghost" className="rounded-none" onClick={download}>
          <Download /> Save
        </Button>
      </div>
    </div>
  );
}

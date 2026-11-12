"use client";

import { KeyRound, ScanLine, ShieldCheck } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { evaluatePass } from "@/shared/pass-policy";
import type { Invitation, VerificationResult } from "@/shared/types";
import { EmptyState, PageHeader } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import { QrScanner } from "./qr-scanner";
import { VerificationPanel } from "./verification-panel";

/** Accepts a raw pass payload, a shared pass link, or a short gate code. */
export function normalizeManualInput(input: string): { kind: "payload"; value: string } | { kind: "code"; value: string } | null {
  const s = input.trim();
  if (!s) return null;
  const hash = s.includes("#") ? s.slice(s.indexOf("#") + 1) : s;
  if (hash.startsWith("GK1.")) return { kind: "payload", value: hash };
  if (/^[A-Za-z0-9]{3}-?[A-Za-z0-9]{3}$/.test(s)) return { kind: "code", value: s.toUpperCase() };
  return { kind: "payload", value: s };
}

export function ScanPage() {
  const [result, setResult] = useState<{ result: VerificationResult; payload: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");

  const verifyPayload = useCallback(async (payload: string) => {
    setBusy(true);
    try {
      const res = await api.post<VerificationResult>("/security/verify-qr", { payload });
      setResult({ result: res, payload });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const verifyCode = async (code: string) => {
    setBusy(true);
    try {
      const matches = await api.get<Invitation[]>("/security/lookup", { q: code });
      const inv = matches[0];
      if (!inv) {
        setResult({
          result: { valid: false, failure: "INVALID_TOKEN", message: `No invitation found for code ${code}.`, invitation: null, allowedAction: null },
          payload: null,
        });
        return;
      }
      const ev = evaluatePass(inv, new Date());
      setResult({
        result: { valid: ev.failure === null, failure: ev.failure, message: ev.message, invitation: inv, allowedAction: ev.allowedAction },
        payload: null,
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = normalizeManualInput(manual);
    if (!parsed) return;
    if (parsed.kind === "payload") void verifyPayload(parsed.value);
    else void verifyCode(parsed.value);
  };

  const reset = () => {
    setResult(null);
    setManual("");
  };

  return (
    <>
      <PageHeader title="Scan pass" description="Verify a visitor's QR pass, confirm their identity, then record entry or exit." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <QrScanner onResult={(text) => !busy && !result && void verifyPayload(text)} paused={busy || Boolean(result)} />
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="text-primary size-4" /> Manual verification
                </CardTitle>
                <CardDescription>No camera? Enter the 6-character gate code or paste the pass link.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitManual} className="flex flex-col gap-2 sm:flex-row" aria-label="Manual verification">
                <Label htmlFor="manual-pass" className="sr-only">
                  Gate code or pass
                </Label>
                <Input
                  id="manual-pass"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="e.g. K7Q-4MX"
                  autoComplete="off"
                  className="font-mono"
                />
                <Button type="submit" loading={busy} disabled={!manual.trim()}>
                  Verify
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
        <div>
          {result ? (
            <VerificationPanel result={result.result} payload={result.payload} onDone={reset} />
          ) : (
            <Card className="h-full min-h-72">
              <EmptyState
                icon={busy ? ScanLine : ShieldCheck}
                title={busy ? "Verifying pass…" : "Waiting for a pass"}
                description="Results appear here: visitor, apartment, approval status and validity. Every scan is recorded in the activity log."
                className="h-full"
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

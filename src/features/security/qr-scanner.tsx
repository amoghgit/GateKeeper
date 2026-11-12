"use client";

import jsQR from "jsqr";
import { Camera, CameraOff, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type ScannerState = "idle" | "starting" | "scanning" | "denied" | "unavailable" | "error";

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Camera QR scanner. Uses the native BarcodeDetector where supported (Chrome,
 * Android) and falls back to jsQR on a canvas elsewhere (Safari, Firefox).
 * Frames never leave the device — only the decoded text is passed up.
 */
export function QrScanner({ onResult, paused }: { onResult: (text: string) => void; paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef<{ text: string; at: number } | null>(null);
  const pausedRef = useRef(paused);
  const onResultRef = useRef(onResult);
  const [state, setState] = useState<ScannerState>("idle");

  useEffect(() => {
    pausedRef.current = paused;
    onResultRef.current = onResult;
  }, [paused, onResult]);

  const stop = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setState("scanning");
      const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
      let lastScan = 0;
      const tick = async (t: number) => {
        frameRef.current = requestAnimationFrame(tick);
        if (t - lastScan < 160 || pausedRef.current || video.readyState < 2) return;
        lastScan = t;
        let text: string | null = null;
        try {
          if (detector) {
            text = (await detector.detect(video))[0]?.rawValue ?? null;
          } else {
            const canvas = canvasRef.current!;
            const w = video.videoWidth;
            const h = video.videoHeight;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(video, 0, 0, w, h);
            text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
          }
        } catch {
          text = null;
        }
        if (!text) return;
        const last = lastRef.current;
        if (last && last.text === text && Date.now() - last.at < 3000) return; // de-bounce repeated frames
        lastRef.current = { text, at: Date.now() };
        navigator.vibrate?.(60);
        onResultRef.current(text);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (err) {
      stop();
      const name = (err as Error).name;
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "unavailable" : "error");
    }
  };

  const active = state === "scanning" || state === "starting";
  return (
    <div className="bg-navy relative aspect-[4/3] w-full overflow-hidden rounded-2xl" data-testid="qr-scanner">
      <video ref={videoRef} className={active ? "size-full object-cover" : "hidden"} muted playsInline aria-label="Camera preview" />
      <canvas ref={canvasRef} className="hidden" />
      {active && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative size-[62%] max-w-[260px] rounded-3xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(13,27,42,0.45)] [--scan-height:100%]">
            {!paused && <div className="animate-scan absolute inset-x-3 top-0 h-0.5 rounded-full bg-teal-300 shadow-[0_0_12px_2px_rgba(94,234,212,0.7)]" />}
          </div>
        </div>
      )}
      {state === "starting" && <LoaderCircle className="absolute top-1/2 left-1/2 size-8 -translate-1/2 animate-spin text-white" />}
      {active && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute right-3 bottom-3"
          onClick={() => {
            stop();
            setState("idle");
          }}
        >
          <CameraOff /> Stop camera
        </Button>
      )}
      {!active && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center text-white">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-white/10">
            {state === "idle" ? <Camera className="size-6" /> : <CameraOff className="size-6" />}
          </span>
          <div>
            <p className="font-semibold">
              {state === "idle" && "Ready to scan"}
              {state === "denied" && "Camera permission denied"}
              {state === "unavailable" && "No camera available"}
              {state === "error" && "Couldn't start the camera"}
            </p>
            <p className="mt-1 max-w-xs text-[13px] text-white/65">
              {state === "idle"
                ? "Point the camera at the visitor's GateKeeper pass."
                : "Use the manual verification below — enter the pass code or paste the pass link."}
            </p>
          </div>
          {(state === "idle" || state === "error" || state === "denied") && (
            <Button onClick={start} className="text-navy bg-white hover:bg-white/90">
              <Camera /> {state === "idle" ? "Open camera" : "Try again"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

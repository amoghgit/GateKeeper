/** Display formatting. Times render in the viewer's locale and zone. */

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });
const dayTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" });

export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const formatTime = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : "—");
export const formatDateTime = (iso: string | null | undefined) => (iso ? dayTimeFmt.format(new Date(iso)) : "—");
export const formatWeekday = (iso: string) => weekdayFmt.format(new Date(iso));

export function formatRelative(iso: string, now: number = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return diff < 0 ? "just now" : "in a moment";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 7 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return formatDate(iso);
}

export function formatDuration(fromIso: string, toIso: string | number = Date.now()): string {
  const to = typeof toIso === "number" ? toIso : new Date(toIso).getTime();
  const mins = Math.max(0, Math.round((to - new Date(fromIso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** "YYYY-MM-DD" for the local calendar day. */
export function localDay(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return localDay(new Date(y, m - 1, d + days));
}

export const compactNumber = (n: number) => new Intl.NumberFormat("en-IN", { notation: n >= 10_000 ? "compact" : "standard" }).format(n);

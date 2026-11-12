/**
 * Time-zone aware calendar helpers built on Intl (no heavy date library).
 * Communities store an IANA zone; "today" always means today in that zone.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "YYYY-MM-DD" of the instant as seen in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** UTC instant of local midnight for a "YYYY-MM-DD" day in `timeZone`. */
export function startOfLocalDay(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  const candidate = new Date(guess - offset);
  // Re-check around DST transitions.
  const offset2 = tzOffsetMs(candidate, timeZone);
  return offset2 === offset ? candidate : new Date(guess - offset2);
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Monday-based ISO week start for a "YYYY-MM-DD" day. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

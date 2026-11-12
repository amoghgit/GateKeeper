"use client";

import { ChartColumn, Table2 } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Card, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * Chart conventions (see the dataviz method): one y-axis, thin marks with 4px
 * rounded data-ends, recessive grid, legend for ≥2 series, hover tooltip on
 * every chart, and a table view for screen readers and exact values.
 * Colors come from validated CSS tokens — text never wears a series color.
 */
export const SERIES = {
  entries: { label: "Entries", color: "var(--chart-entries)" },
  exits: { label: "Exits", color: "var(--chart-exits)" },
} as const;

const axis = { stroke: "var(--chart-axis)", fontSize: 11, tickLine: false, axisLine: false } as const;

function TooltipBox({ active, payload, label, formatLabel }: TooltipContentProps<number, string> & { formatLabel?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border bg-surface rounded-lg border px-3 py-2 text-xs shadow-[var(--shadow-raised)]">
      <p className="text-foreground mb-1 font-medium">{formatLabel ? formatLabel(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="text-ink-soft flex items-center gap-2">
          <span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="flex-1">{p.name}</span>
          <span className="text-foreground font-medium tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function Legend({ keys }: { keys: (keyof typeof SERIES)[] }) {
  if (keys.length < 2) return null;
  return (
    <ul className="text-ink-soft flex items-center gap-4 text-xs" aria-label="Legend">
      {keys.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: SERIES[k].color }} aria-hidden />
          {SERIES[k].label}
        </li>
      ))}
    </ul>
  );
}

export function ChartCard<T extends object>({
  title,
  description,
  rows,
  columns,
  legend = [],
  children,
  className,
}: {
  title: string;
  description?: string;
  rows: T[];
  columns: { key: keyof T; label: string; format?: (v: T[keyof T]) => string }[];
  legend?: (keyof typeof SERIES)[];
  children: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex items-center gap-3">
          {view === "chart" && <Legend keys={legend} />}
          <button
            onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
            className="text-muted-foreground hover:bg-surface-muted hover:text-foreground rounded-md p-1.5"
            aria-label={view === "chart" ? `Show ${title} as a table` : `Show ${title} as a chart`}
            title={view === "chart" ? "Table view" : "Chart view"}
          >
            {view === "chart" ? <Table2 className="size-4" /> : <ChartColumn className="size-4" />}
          </button>
        </div>
      </CardHeader>
      {view === "chart" ? (
        <div className="h-64 px-2 pt-2 pb-4 sm:px-4">{children}</div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <Table>
            <THead>
              <tr>
                {columns.map((c) => (
                  <TH key={String(c.key)}>{c.label}</TH>
                ))}
              </tr>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={i}>
                  {columns.map((c) => (
                    <TD key={String(c.key)} className="tabular-nums">
                      {c.format ? c.format(r[c.key]) : String(r[c.key])}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export function TrendLines({ data, xKey, xFormat }: { data: object[]; xKey: string; xFormat: (v: string) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={xKey} {...axis} tickFormatter={xFormat} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} width={40} />
        <Tooltip
          content={(p) => <TooltipBox {...(p as TooltipContentProps<number, string>)} formatLabel={xFormat} />}
          cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
        />
        {(["entries", "exits"] as const).map((k) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            name={SERIES[k].label}
            stroke={SERIES[k].color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GroupedBars({ data, xKey, xFormat, keys }: { data: object[]; xKey: string; xFormat: (v: string) => string; keys: (keyof typeof SERIES)[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={xKey} {...axis} tickFormatter={xFormat} />
        <YAxis {...axis} allowDecimals={false} width={40} />
        <Tooltip
          content={(p) => <TooltipBox {...(p as TooltipContentProps<number, string>)} formatLabel={xFormat} />}
          cursor={{ fill: "var(--surface-muted)" }}
        />
        {keys.map((k) => (
          <Bar key={k} dataKey={k} name={SERIES[k].label} fill={SERIES[k].color} radius={[4, 4, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBars({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" {...axis} allowDecimals={false} />
        <YAxis type="category" dataKey="label" {...axis} width={112} tick={{ fill: "var(--ink-soft)", fontSize: 12 }} />
        <Tooltip content={(p) => <TooltipBox {...(p as TooltipContentProps<number, string>)} />} cursor={{ fill: "var(--surface-muted)" }} />
        <Bar dataKey="value" name="Visits" fill={SERIES.entries.color} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

"use client";

import { ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { Invitation } from "@/shared/types";
import { CategoryLabel, StatusBadge } from "@/components/shared/badges";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "visitor" | "arrival" | "status" | "apartment";

export function InvitationTable({
  items,
  onOpen,
  showApartment = true,
  showResident = false,
}: {
  items: Invitation[];
  onOpen: (id: string) => void;
  showApartment?: boolean;
  showResident?: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "arrival", dir: -1 });
  const sorted = useMemo(() => {
    const val = (i: Invitation) =>
      sort.key === "visitor" ? i.visitor.fullName : sort.key === "status" ? i.status : sort.key === "apartment" ? i.apartmentLabel : i.expectedArrival;
    return [...items].sort((a, b) => val(a).localeCompare(val(b)) * sort.dir);
  }, [items, sort]);

  const header = (key: SortKey, label: string) => (
    <TH aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        className={cn("hover:text-foreground inline-flex items-center gap-1 uppercase", sort.key === key && "text-foreground")}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }))}
      >
        {label} <ArrowUpDown className="size-3" aria-hidden />
      </button>
    </TH>
  );

  return (
    <Table>
      <THead>
        <tr>
          {header("visitor", "Visitor")}
          <TH>Category</TH>
          {showApartment && header("apartment", "Apartment")}
          {showResident && <TH>Resident</TH>}
          {header("arrival", "Expected")}
          {header("status", "Status")}
        </tr>
      </THead>
      <TBody>
        {sorted.map((i) => (
          <TR key={i.invitationId} className="cursor-pointer" onClick={() => onOpen(i.invitationId)}>
            <TD>
              <button className="text-left" onClick={(e) => (e.stopPropagation(), onOpen(i.invitationId))}>
                <span className="text-foreground block font-medium">{i.visitor.fullName}</span>
                <span className="text-muted-foreground block text-xs">
                  {i.visitor.purpose} · <span className="font-mono">{i.code}</span>
                </span>
              </button>
            </TD>
            <TD>
              <CategoryLabel category={i.visitor.category} />
            </TD>
            {showApartment && <TD className="whitespace-nowrap">{i.apartmentLabel}</TD>}
            {showResident && <TD className="whitespace-nowrap">{i.residentName}</TD>}
            <TD className="whitespace-nowrap">{formatDateTime(i.expectedArrival)}</TD>
            <TD>
              <StatusBadge status={i.status} overdue={i.overdue} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

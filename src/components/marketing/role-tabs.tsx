"use client";

import { Building2, ShieldCheck, UserRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { RolePreview } from "./product-preview";

const ROLES = [
  { value: "resident", label: "Residents", icon: UserRound, copy: "Invite visitors in seconds, share a QR pass, and approve walk-ins from anywhere." },
  { value: "security", label: "Security", icon: ShieldCheck, copy: "Scan, verify and record entries in a single, glanceable flow built for the gate." },
  { value: "admin", label: "Administrators", icon: Building2, copy: "Manage residents and staff, monitor traffic, export reports and audit every decision." },
] as const;

export function RoleTabs() {
  return (
    <Tabs defaultValue="resident" className="w-full">
      <div className="flex justify-center">
        <TabsList>
          {ROLES.map((r) => (
            <TabsTrigger key={r.value} value={r.value}>
              <r.icon className="size-3.5" /> {r.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {ROLES.map((r) => (
        <TabsContent key={r.value} value={r.value} className="animate-fade-in mt-8">
          <p className="text-muted-foreground mx-auto mb-8 max-w-xl text-center text-[15px]">{r.copy}</p>
          <div className="border-border bg-surface rounded-2xl border p-5 shadow-[var(--shadow-raised)] sm:p-8">
            <RolePreview role={r.value} />
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

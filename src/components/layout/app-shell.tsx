"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, LogOut, Menu, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { dashboardFor, type Role } from "@/shared/domain";
import type { AppNotification, Page } from "@/shared/types";
import { Logo } from "@/components/shared/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SheetContent,
} from "@/components/ui/overlays";
import { Skeleton } from "@/components/ui/primitives";
import { api, ApiClientError, authApi } from "@/lib/api-client";
import { formatRelative, initials } from "@/lib/format";
import { useAction, useMe } from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { activeHref, NAVIGATION, ROLE_LABELS } from "./navigation";
import { Dialog as DialogPrimitive } from "radix-ui";

function SidebarNav({ role, unread, onNavigate }: { role: Role; unread: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = activeHref(role, pathname);
  return (
    <nav aria-label="Main" className="flex flex-col gap-6 px-3">
      {NAVIGATION[role].map((section, i) => (
        <div key={i}>
          {section.title && <p className="text-muted-foreground mb-1.5 px-3 text-[11px] font-medium tracking-wider uppercase">{section.title}</p>}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                      isActive ? "bg-primary-soft text-primary" : "text-ink-soft hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className={cn("size-4.5", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {item.badge === "notifications" && unread > 0 && (
                      <span className="bg-primary rounded-full px-1.5 py-px text-[11px] font-semibold text-white tabular-nums">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NotificationsMenu({ role, unread }: { role: Role; unread: number }) {
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ["notifications", "menu"],
    queryFn: () => api.get<Page<AppNotification>>("/notifications", { limit: 8 }),
    enabled: open,
  });
  const markAll = useAction(() => api.post("/notifications/read-all"), { invalidate: [["notifications"], ["me"]] });
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative">
          <Bell className="size-4.5" />
          {unread > 0 && <span className="bg-primary ring-surface absolute top-1.5 right-1.5 size-2 rounded-full ring-2" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[min(92vw,380px)] p-0">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="sm" onClick={() => markAll.mutate(undefined)} disabled={unread === 0 || markAll.isPending}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {list.isLoading && (
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
          {list.data?.items.length === 0 && <p className="text-muted-foreground px-4 py-8 text-center text-[13px]">You&apos;re all caught up.</p>}
          {list.data?.items.map((n) => (
            <DropdownMenuItem key={n.notificationId} asChild className="border-border items-start rounded-none border-b px-4 py-3 last:border-0">
              <Link href={n.link ?? (role === "RESIDENT" ? "/resident/notifications" : dashboardFor(role))}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-hidden />
                <span className="min-w-0">
                  <span className="text-foreground block text-[13px] font-medium">{n.title}</span>
                  <span className="text-muted-foreground line-clamp-2 block text-xs">{n.message}</span>
                  <span className="text-muted-foreground mt-1 block text-[11px]">{formatRelative(n.createdAt)}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))}
        </div>
        {role === "RESIDENT" && (
          <div className="border-border border-t p-2">
            <DropdownMenuItem asChild className="text-primary justify-center">
              <Link href="/resident/notifications">View all notifications</Link>
            </DropdownMenuItem>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const profile = me.data?.profile;

  // Client-side role routing (the API enforces authorization independently).
  useEffect(() => {
    if (me.error instanceof ApiClientError && me.error.status === 401) router.replace("/login");
    if (!profile) return;
    if (profile.status !== "ACTIVE" || !profile.role) router.replace("/pending");
    else if (profile.role !== role) router.replace(dashboardFor(profile.role));
  }, [me.error, profile, role, router]);

  const signOut = async () => {
    try {
      await authApi.post("logout");
    } catch {
      /* cookies are cleared regardless */
    }
    qc.clear();
    toast.success("Signed out");
    router.replace("/login");
  };

  if (!profile || profile.role !== role || profile.status !== "ACTIVE") {
    return (
      <div className="flex flex-1" aria-busy="true">
        <aside className="border-border bg-surface hidden w-64 border-r lg:block" />
        <main className="flex-1 space-y-4 p-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
          <div className="grid gap-4 pt-4 sm:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </main>
      </div>
    );
  }

  const unread = me.data?.unreadNotifications ?? 0;
  const sidebar = (onNavigate?: () => void) => (
    <>
      <div className="flex h-16 items-center px-6">
        <Logo href={dashboardFor(role)} />
      </div>
      <div className="border-border bg-surface-muted/60 mx-3 mb-5 rounded-xl border px-3 py-2.5">
        <p className="text-foreground truncate text-[13px] font-semibold">{me.data?.community.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {ROLE_LABELS[role]}
          {profile.apartmentLabel ? ` · ${profile.apartmentLabel}` : ""}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto pb-6">
        <SidebarNav role={role} unread={unread} onNavigate={onNavigate} />
      </div>
    </>
  );

  return (
    <div className="flex flex-1">
      <aside className="border-border bg-surface sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r lg:flex">{sidebar()}</aside>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          {sidebar(() => setMobileOpen(false))}
        </SheetContent>
      </Dialog>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background/85 sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 backdrop-blur sm:px-6 lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
          <div className="flex-1" />
          <NotificationsMenu role={role} unread={unread} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="hover:bg-surface-muted flex items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 transition-colors" aria-label="Account menu">
                <span className="bg-navy flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white">
                  {initials(profile.fullName)}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="text-foreground block text-[13px] leading-tight font-medium">{profile.fullName}</span>
                  <span className="text-muted-foreground block text-[11px] leading-tight">{ROLE_LABELS[role]}</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{profile.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {role === "RESIDENT" && (
                <DropdownMenuItem asChild>
                  <Link href="/resident/profile">
                    <UserRound /> Profile
                  </Link>
                </DropdownMenuItem>
              )}
              {role === "ADMIN" && (
                <DropdownMenuItem asChild>
                  <Link href="/admin/settings">
                    <Settings /> Settings
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={signOut} className="text-danger data-[highlighted]:text-danger">
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="animate-fade-in mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

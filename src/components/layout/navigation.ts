import {
  Activity,
  Bell,
  Building2,
  ChartColumn,
  ClipboardList,
  DoorOpen,
  History,
  Layers,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  QrCode,
  ScanLine,
  ScrollText,
  Settings,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import type { Role } from "@/shared/domain";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "notifications";
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const NAVIGATION: Record<Role, NavSection[]> = {
  RESIDENT: [
    {
      items: [
        { href: "/resident/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/resident/invitations", label: "Invitations", icon: QrCode },
        { href: "/resident/invitations/new", label: "Invite a visitor", icon: UserPlus },
        { href: "/resident/visitors", label: "Visitor history", icon: History },
      ],
    },
    {
      title: "Account",
      items: [
        { href: "/resident/notifications", label: "Notifications", icon: Bell, badge: "notifications" },
        { href: "/resident/profile", label: "Profile", icon: UserRound },
      ],
    },
  ],
  SECURITY: [
    {
      items: [
        { href: "/security/dashboard", label: "Gate overview", icon: LayoutDashboard },
        { href: "/security/scan", label: "Scan pass", icon: ScanLine },
        { href: "/security/manual-entry", label: "Manual entry", icon: ClipboardList },
        { href: "/security/currently-inside", label: "Currently inside", icon: DoorOpen },
        { href: "/security/activity", label: "Activity log", icon: Activity },
      ],
    },
  ],
  ADMIN: [
    {
      items: [
        { href: "/admin/dashboard", label: "Overview", icon: LayoutDashboard },
        { href: "/admin/analytics", label: "Analytics", icon: ChartColumn },
        { href: "/admin/visitors", label: "Visitors", icon: UsersRound },
      ],
    },
    {
      title: "People",
      items: [
        { href: "/admin/residents", label: "Residents", icon: Users },
        { href: "/admin/security", label: "Security staff", icon: ShieldCheck },
      ],
    },
    {
      title: "Property",
      items: [
        { href: "/admin/buildings", label: "Buildings", icon: Building2 },
        { href: "/admin/apartments", label: "Apartments", icon: Layers },
      ],
    },
    {
      title: "Community",
      items: [
        { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
        { href: "/admin/audit-logs", label: "Audit log", icon: ScrollText },
        { href: "/admin/settings", label: "Settings", icon: Settings },
      ],
    },
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  RESIDENT: "Resident",
  SECURITY: "Security",
  ADMIN: "Administrator",
};

/** The most specific nav item matching a path (so /invitations/new does not also highlight /invitations). */
export function activeHref(role: Role, pathname: string): string | null {
  const all = NAVIGATION[role].flatMap((s) => s.items.map((i) => i.href));
  const matches = all.filter((h) => pathname === h || pathname.startsWith(`${h}/`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

import type { Metadata } from "next";
import { SettingsPage } from "@/features/admin/community";
import { isDemoDisplay } from "@/server/display-mode";

export const metadata: Metadata = { title: "Settings" };

export default async function Page() {
  return <SettingsPage demo={await isDemoDisplay()} />;
}

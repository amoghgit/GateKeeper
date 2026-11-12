"use client";

import { Hourglass, LogOut, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { dashboardFor } from "@/shared/domain";
import { Logo } from "@/components/shared/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { authApi } from "@/lib/api-client";
import { useMe } from "@/lib/hooks";

export default function PendingPage() {
  const me = useMe();
  const router = useRouter();
  const profile = me.data?.profile;

  useEffect(() => {
    if (profile?.status === "ACTIVE" && profile.role) router.replace(dashboardFor(profile.role));
  }, [profile, router]);

  const deactivated = profile?.status === "DEACTIVATED";
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-16">
      <Logo className="mb-10" />
      <Card className="w-full max-w-md p-8 text-center">
        <span className="bg-warning-soft text-warning mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl">
          <Hourglass className="size-5" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{deactivated ? "Account inactive" : "Awaiting approval"}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {deactivated
            ? "This account has been deactivated. Contact your community office if you believe this is a mistake."
            : `Thanks${profile ? `, ${profile.fullName.split(" ")[0]}` : ""}. Your administrator needs to confirm your apartment${profile?.requestedUnit ? ` (${profile.requestedUnit})` : ""} before you can invite visitors.`}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="secondary" onClick={() => me.refetch()} loading={me.isFetching}>
            <RefreshCw /> Check again
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await authApi.post("logout").catch(() => undefined);
              router.replace("/login");
            }}
          >
            <LogOut /> Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { LogoMark } from "@/components/shared/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <LogoMark className="mb-6 size-10" />
      <p className="text-primary text-sm font-medium">404</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm">The link may be broken or the page may have moved.</p>
      <Button className="mt-6" asChild>
        <Link href="/">Back to GateKeeper</Link>
      </Button>
    </div>
  );
}

"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/primitives";

export function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="text-muted-foreground hover:bg-surface-muted hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function AuthHeading({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{description}</p>
    </div>
  );
}

export function FormAlert({ message, tone = "danger" }: { message: string | null; tone?: "danger" | "info" }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={
        tone === "danger"
          ? "border-danger/20 bg-danger-soft text-danger rounded-lg border px-3.5 py-2.5 text-[13px]"
          : "border-info/20 bg-info-soft text-info rounded-lg border px-3.5 py-2.5 text-[13px]"
      }
    >
      {message}
    </div>
  );
}

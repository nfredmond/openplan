"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BillingTriageLinkCopy({
  href,
  label = "Copy triage link",
}: {
  href: string;
  label?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const handleCopy = async () => {
    try {
      const shareUrl = href.startsWith("http") ? href : `${window.location.origin}${href}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
      {copyState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : label}
    </Button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RtpPublicShareControls({
  rtpCycleId,
  initialEnabled,
  initialToken,
}: {
  rtpCycleId: string;
  initialEnabled: boolean;
  initialToken: string | null;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [token, setToken] = useState(initialToken);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publicPath = token ? `/plan/${token}` : null;
  const publicUrl = publicPath && typeof window !== "undefined" ? `${window.location.origin}${publicPath}` : publicPath;

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/public-share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const payload = (await response.json()) as { error?: string; enabled?: boolean; token?: string | null };
      if (!response.ok) throw new Error(payload.error || "Failed to update public sharing");
      setEnabled(Boolean(payload.enabled));
      if (payload.token) setToken(payload.token);
      router.refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update public sharing");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select and copy the link manually.");
    }
  }

  return (
    <div className="rounded-[0.5rem] border border-border/70 bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Globe className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground">Public &ldquo;why we fund this&rdquo; view</p>
            <p className="text-xs text-muted-foreground">
              Publish a read-only page showing the prioritized portfolio and the reasons behind it, to share with the community.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={enabled ? "outline" : "default"}
          onClick={() => void toggle(!enabled)}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {enabled ? "Unpublish" : "Publish public view"}
        </Button>
      </div>

      {enabled && publicUrl ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-border bg-muted/30 px-3 py-2">
          <a
            href={publicPath ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-xs text-foreground underline-offset-2 hover:underline"
          >
            {publicUrl}
          </a>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  );
}

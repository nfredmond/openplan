"use client";

import { useState, type FormEvent } from "react";
import { Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Rendered ONLY when the campaign's email transport is configured (the portal
// gates on emailUpdatesAvailable), so this never promises email that can't send.
export function PublicSubscribeForm({ shareToken }: { shareToken: string }) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/engage/${shareToken}/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, website }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "Subscription failed");
      setMessage(payload.message || "Thanks — check your email to confirm.");
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">Get email updates</p>
      </div>
      <p className="text-xs text-muted-foreground">
        We&rsquo;ll email you when the project team posts an update. You can unsubscribe anytime.
      </p>
      {message ? (
        <p className="rounded-lg border border-emerald-300/60 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
          {message}
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              type="email"
              required
              value={email}
              placeholder="you@example.com"
              onChange={(event) => setEmail(event.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={busy || !email}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Notify me
            </Button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </>
      )}
      {/* Honeypot */}
      <div className="absolute -left-[9999px] opacity-0" aria-hidden="true">
        <label htmlFor="subscribe-website">Website</label>
        <input
          id="subscribe-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
    </form>
  );
}

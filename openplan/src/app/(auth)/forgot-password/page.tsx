"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function noticeClass(tone: "info" | "success" | "danger") {
  const toneMap = {
    info: "border-sky-300/80 bg-sky-50/75 text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100",
    success:
      "border-emerald-300/80 bg-emerald-50/75 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100",
    danger: "border-red-300/80 bg-red-50/75 text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200",
  } as const;
  return `border-l-2 px-4 py-3 text-sm ${toneMap[tone]}`;
}

function frameClassName() {
  return "w-full max-w-xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.8),rgba(248,250,247,0.95))] shadow-[0_20px_44px_rgba(15,23,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(15,23,32,0.9),rgba(11,18,26,0.96))]";
}

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      // Land on the shared callback so the code is redeemed into a session
      // before the user is asked for a new password.
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    setLoading(false);

    // Deliberately NOT branching the visible outcome on whether the address
    // exists: a different message for a real vs unknown email turns this form
    // into an account-enumeration oracle. Real failures (network, rate limit)
    // still surface, because those are actionable.
    if (resetError && !/user not found|invalid/i.test(resetError.message)) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <section className={frameClassName()}>
      <header className="border-b border-border/60 px-6 py-5 sm:px-7">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Reset password
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          Get back into your workspace.
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We&apos;ll email you a link to set a new password. The link is single-use and expires.
        </p>
      </header>

      <div className="space-y-4 px-6 py-5 sm:px-7">
        {sent ? (
          <article className={noticeClass("success")} role="status">
            <p className="font-semibold">Check your email.</p>
            <p className="mt-1.5">
              If an account exists for {email || "that address"}, a reset link is on its way. It can take
              a minute to arrive — check spam before requesting another.
            </p>
          </article>
        ) : (
          <form className="space-y-5" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Work email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="name@agency.gov"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {error ? (
              <p className={noticeClass("danger")} role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                No account access required.
              </p>
              <Button type="submit" className="sm:min-w-40" disabled={loading}>
                {loading ? "Sending..." : "Email me a reset link"}
              </Button>
            </div>
          </form>
        )}
      </div>

      <footer className="border-t border-border/60 px-6 py-4 text-sm text-muted-foreground sm:px-7">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-semibold text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
        .
      </footer>
    </section>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <section className={frameClassName()}>
          <div className="px-6 py-6 text-sm text-muted-foreground sm:px-7">Loading…</div>
        </section>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}

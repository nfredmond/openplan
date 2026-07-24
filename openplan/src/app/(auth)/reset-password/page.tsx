"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

/** Supabase's own minimum. Stated up front rather than only on rejection. */
const MIN_PASSWORD_LENGTH = 8;

function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "missing">("checking");

  // The callback route redeems the emailed code into a session before landing
  // here, so a real recovery visit already has one. Arriving without a session
  // means the link expired, was already used, or the page was opened directly —
  // say so instead of showing a form whose submit could only fail.
  useEffect(() => {
    let active = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setSessionState(data.user ? "ready" : "missing");
      });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (sessionState === "checking") {
    return (
      <section className={frameClassName()}>
        <div className="px-6 py-6 text-sm text-muted-foreground sm:px-7">Checking your reset link…</div>
      </section>
    );
  }

  if (sessionState === "missing") {
    return (
      <section className={frameClassName()}>
        <header className="border-b border-border/60 px-6 py-5 sm:px-7">
          <h2 className="font-display text-3xl font-semibold tracking-tight">This reset link is no longer valid.</h2>
        </header>
        <div className="px-6 py-5 sm:px-7">
          <article className={noticeClass("info")}>
            <p>
              Reset links are single-use and expire. Request a new one and it will work straight away.
            </p>
          </article>
          <div className="mt-4">
            <Link
              href="/forgot-password"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              Request a new reset link
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={frameClassName()}>
      <header className="border-b border-border/60 px-6 py-5 sm:px-7">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Reset password
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">Choose a new password.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters. You&apos;ll go straight to your dashboard afterwards.
        </p>
      </header>

      <div className="space-y-4 px-6 py-5 sm:px-7">
        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="grid gap-4">
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                New password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirm" className="text-sm font-medium text-foreground">
                Confirm new password
              </label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          </div>

          {error ? (
            <p className={noticeClass("danger")} role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Back to your workspace.</p>
            <Button type="submit" className="sm:min-w-40" disabled={loading}>
              {loading ? "Saving..." : "Set new password"}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <section className={frameClassName()}>
          <div className="px-6 py-6 text-sm text-muted-foreground sm:px-7">Loading…</div>
        </section>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

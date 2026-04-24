"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function noticeClass(tone: "info" | "success" | "warning" | "danger") {
  const toneMap = {
    info: "border-sky-300/80 bg-sky-50/75 text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100",
    success: "border-emerald-300/80 bg-emerald-50/75 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100",
    warning: "border-amber-300/80 bg-amber-50/75 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100",
    danger: "border-red-300/80 bg-red-50/75 text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200",
  } as const;

  return `border-l-2 px-4 py-3 text-sm ${toneMap[tone]}`;
}

function frameClassName() {
  return "w-full max-w-xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.8),rgba(248,250,247,0.95))] shadow-[0_20px_44px_rgba(15,23,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(15,23,32,0.9),rgba(11,18,26,0.96))]";
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutState = searchParams.get("checkout");
  const activationState = searchParams.get("activation");
  const redirectTarget = searchParams.get("redirect") ?? "/dashboard";
  const createdState = searchParams.get("created");
  const selectedPlan = searchParams.get("plan") ?? "starter";
  const inviteToken = searchParams.get("invite");
  const signUpHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("plan", selectedPlan);
    params.set("redirect", redirectTarget);
    if (inviteToken) params.set("invite", inviteToken);
    return `/sign-up?${params.toString()}`;
  }, [inviteToken, redirectTarget, selectedPlan]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    if (inviteToken) {
      const invitationResponse = await fetch("/api/workspaces/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: inviteToken }),
      });

      if (!invitationResponse.ok) {
        const result = await invitationResponse.json().catch(() => null);
        setError(result?.error ?? "Could not accept this workspace invitation");
        setLoading(false);
        return;
      }
    }

    const nextPath = redirectTarget && redirectTarget.startsWith("/") ? redirectTarget : "/dashboard";
    router.push(nextPath);
    router.refresh();
  }

  return (
    <section className={frameClassName()}>
      <header className="border-b border-border/60 px-6 py-5 sm:px-7">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Sign in</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">Resume work inside the correct workspace.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Access your OpenPlan workspace, then confirm the project and billing context before you continue into delivery work.
        </p>
      </header>

      <div className="space-y-4 px-6 py-5 sm:px-7">
        {createdState === "1" ? (
          <article className={noticeClass("info")}>
            <p className="font-semibold">
              {inviteToken ? "Account created — next step is invitation acceptance." : "Account created — next step is your first workspace."}
            </p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Sign in with the email and password you just created.</li>
              {inviteToken ? (
                <li>OpenPlan will accept the workspace invitation before loading the dashboard.</li>
              ) : (
                <>
                  <li>Create or open the correct workspace from Projects.</li>
                  <li>
                    If you selected {selectedPlan === "starter" ? "Starter" : selectedPlan === "professional" ? "Professional" : "an early-access"} pricing,
                    launch billing only after you are inside the correct workspace context.
                  </li>
                </>
              )}
            </ol>
          </article>
        ) : null}

        {inviteToken && createdState !== "1" ? (
          <article className={noticeClass("info")}>
            <p className="font-semibold">Workspace invitation link detected.</p>
            <p className="mt-1.5">Sign in with the invited work email to join the workspace.</p>
          </article>
        ) : null}

        {checkoutState === "success" ? (
          <article className={noticeClass("success")}>
            <p className="font-semibold">Payment received. Activation still needs the identity handoff.</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Check your email for “Activate your access.”</li>
              <li>If needed, create an account with the same checkout email.</li>
              <li>Activate access, then return here and sign in to the dashboard.</li>
            </ol>
          </article>
        ) : null}

        {checkoutState === "error" || activationState === "error" ? (
          <article className={noticeClass("warning")}>
            <p className="font-semibold">We could not confirm activation yet.</p>
            <p className="mt-1.5">
              If a payment attempt failed, no charge was made. If confirmation timed out, duplicate charges are still prevented.
            </p>
            <p className="mt-1.5">Next step: retry checkout once, or contact support if this persists.</p>
          </article>
        ) : null}

        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="grid gap-4">
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
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Credential check, then workspace selection.</p>
            <Button type="submit" className="sm:min-w-40" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </div>
        </form>
      </div>

      <footer className="border-t border-border/60 px-6 py-4 text-sm text-muted-foreground sm:px-7">
        New to OpenPlan?{" "}
        <Link href={signUpHref} className="font-semibold text-foreground underline underline-offset-4">
          Create an account
        </Link>
        .
      </footer>
    </section>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <section className={frameClassName()}>
          <div className="px-6 py-6 text-sm text-muted-foreground sm:px-7">Loading sign-in…</div>
        </section>
      }
    >
      <SignInForm />
    </Suspense>
  );
}

"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invitationPath } from "@/lib/workspaces/invitation-path";
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
  const redirectTarget = searchParams.get("redirect") ?? "/dashboard";
  const createdState = searchParams.get("created");
  // Set by /auth/callback when an emailed link could not be redeemed (expired,
  // already used). Without this the user is bounced here with no explanation.
  const authError = searchParams.get("auth_error");
  const inviteToken = searchParams.get("invite");
  const signUpHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("redirect", redirectTarget);
    if (inviteToken) params.set("invite", inviteToken);
    return `/sign-up?${params.toString()}`;
  }, [inviteToken, redirectTarget]);
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

    /*
      SIGNING IN IS NOT ACCEPTING.

      This form used to POST the invite token to
      `/api/workspaces/invitations/accept` right here, so a person who followed
      an invitation link to SEE what they had been sent joined the workspace by
      the act of authenticating — never shown its name, the role they were
      granted, or who invited them, and with no way to decline. The decision now
      belongs to `/invitations/[token]`, which the invitation link points at and
      which `redirectTarget` carries us to.

      The token is still read from the URL, but only to keep it attached to the
      sign-up link and the redirect. Authentication decides who you are; it does
      not answer a question on your behalf.
    */
    const nextPath =
      inviteToken && !redirectTarget.startsWith("/invitations/")
        ? invitationPath(inviteToken)
        : redirectTarget && redirectTarget.startsWith("/")
          ? redirectTarget
          : "/dashboard";
    router.push(nextPath);
    router.refresh();
  }

  return (
    <section className={frameClassName()}>
      <header className="border-b border-border/60 px-6 py-5 sm:px-7">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Sign in</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">Sign in to your workspace.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Pick up project work, run history, and board-ready packets right where you left them — maps, engagement, and reporting stay connected.
        </p>
      </header>

      <div className="space-y-4 px-6 py-5 sm:px-7">
        {createdState === "1" ? (
          <article className={noticeClass("info")}>
            <p className="font-semibold">
              {inviteToken ? "Account created — next step is the invitation itself." : "Account created — next step is your first workspace."}
            </p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Sign in with the email and password you just created.</li>
              {inviteToken ? (
                <li>OpenPlan will show you the invitation — what workspace, what role, who sent it — to accept or decline.</li>
              ) : (
                <li>Your workspace was created with your account — the dashboard opens straight into it.</li>
              )}
            </ol>
          </article>
        ) : null}

        {authError ? (
          <article className={noticeClass("warning")} role="alert">
            <p className="font-semibold">That link could not be used.</p>
            <p className="mt-1.5">{authError}</p>
            <p className="mt-1.5">
              <Link href="/forgot-password" className="font-semibold underline underline-offset-4">
                Request a new reset link
              </Link>
              .
            </p>
          </article>
        ) : null}

        {inviteToken && createdState !== "1" ? (
          <article className={noticeClass("info")}>
            <p className="font-semibold">Workspace invitation link detected.</p>
            <p className="mt-1.5">Sign in with the invited work email and OpenPlan will show you the invitation to accept or decline.</p>
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
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Forgot password?
                </Link>
              </div>
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
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Back to your planning workspace.</p>
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

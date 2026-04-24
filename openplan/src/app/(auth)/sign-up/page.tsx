"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function normalizeSelectedPlan(value: string | null): "starter" | "professional" | null {
  if (value === "starter" || value === "professional") {
    return value;
  }

  return null;
}

function labelForPlan(value: "starter" | "professional" | null): string {
  if (value === "starter") return "Starter";
  if (value === "professional") return "Professional";
  return "OpenPlan";
}

function noticeClass(tone: "info" | "danger") {
  const toneMap = {
    info: "border-sky-300/80 bg-sky-50/75 text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100",
    danger: "border-red-300/80 bg-red-50/75 text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200",
  } as const;

  return `border-l-2 px-4 py-3 text-sm ${toneMap[tone]}`;
}

function frameClassName() {
  return "w-full max-w-xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.8),rgba(248,250,247,0.95))] shadow-[0_20px_44px_rgba(15,23,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(15,23,32,0.9),rgba(11,18,26,0.96))]";
}

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get("redirect") ?? "/dashboard";
  const inviteToken = searchParams.get("invite");
  const selectedPlan = useMemo(() => normalizeSelectedPlan(searchParams.get("plan")), [searchParams]);
  const signInHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedPlan) params.set("plan", selectedPlan);
    if (redirectTarget) params.set("redirect", redirectTarget);
    if (inviteToken) params.set("invite", inviteToken);
    return `/sign-in?${params.toString()}`;
  }, [inviteToken, redirectTarget, selectedPlan]);
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { org_name: orgName.trim() },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({ created: "1", redirect: redirectTarget });
    if (selectedPlan) {
      params.set("plan", selectedPlan);
    }
    if (inviteToken) {
      params.set("invite", inviteToken);
    }

    router.push(`/sign-in?${params.toString()}`);
    router.refresh();
  }

  return (
    <section className={frameClassName()}>
      <header className="border-b border-border/60 px-6 py-5 sm:px-7">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Create account</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">Create the identity before the workspace is activated.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This step establishes the operator account only. Workspace setup, billing selection, and paid activation still happen after sign-in so OpenPlan can target the right workspace explicitly.
        </p>
      </header>

      <div className="space-y-4 px-6 py-5 sm:px-7">
        {selectedPlan ? (
          <article className={noticeClass("info")}>
            <p className="font-semibold">Selected early-access plan: {labelForPlan(selectedPlan)}</p>
            <p className="mt-1.5">
              This step creates your account only. After sign-in, create or open the correct workspace, then launch billing from the in-app billing surface.
            </p>
          </article>
        ) : null}

        {inviteToken ? (
          <article className={noticeClass("info")}>
            <p className="font-semibold">Workspace invitation link detected.</p>
            <p className="mt-1.5">
              Create the account with the invited work email, then sign in from this flow to join the workspace.
            </p>
          </article>
        ) : null}

        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="grid gap-4">
            <div className="space-y-2">
              <label htmlFor="org-name" className="text-sm font-medium text-foreground">
                Organization
              </label>
              <Input
                id="org-name"
                type="text"
                autoComplete="organization"
                placeholder="Regional Planning Commission"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Work email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="planner@agency.gov"
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
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                minLength={8}
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
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Account first, workspace targeting second.</p>
            <Button type="submit" className="sm:min-w-44" disabled={loading}>
              {loading ? "Creating account..." : "Create account"}
            </Button>
          </div>
        </form>
      </div>

      <footer className="flex flex-col gap-2 border-t border-border/60 px-6 py-4 text-sm text-muted-foreground sm:px-7">
        <p>
          Already have an account?{" "}
          <Link href={signInHref} className="font-semibold text-foreground underline underline-offset-4">
            Sign in
          </Link>
          .
        </p>
        <p className="text-xs text-muted-foreground">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
            terms of use
          </Link>
          ,{" "}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
            privacy practices
          </Link>
          , and{" "}
          <Link href="/legal" className="underline underline-offset-4 hover:text-foreground">
            legal notice
          </Link>{" "}
          that govern supervised early access.
        </p>
      </footer>
    </section>
  );
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <section className={frameClassName()}>
          <div className="px-6 py-6 text-sm text-muted-foreground sm:px-7">Loading sign-up…</div>
        </section>
      }
    >
      <SignUpForm />
    </Suspense>
  );
}

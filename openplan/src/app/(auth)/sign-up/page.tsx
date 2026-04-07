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

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get("redirect") ?? "/dashboard";
  const selectedPlan = useMemo(() => normalizeSelectedPlan(searchParams.get("plan")), [searchParams]);
  const signInHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedPlan) params.set("plan", selectedPlan);
    if (redirectTarget) params.set("redirect", redirectTarget);
    return `/sign-in?${params.toString()}`;
  }, [redirectTarget, selectedPlan]);
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

    router.push(`/sign-in?${params.toString()}`);
    router.refresh();
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6 rounded-2xl border border-border/80 bg-card p-6 shadow-[0_16px_48px_rgba(20,33,43,0.08)] sm:p-8">
      <header className="space-y-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Create account</h1>
        <p className="text-sm text-muted-foreground">
          Create your OpenPlan login first. Workspace setup, billing selection, and paid activation happen after sign-in so the correct workspace can be targeted explicitly.
        </p>
      </header>

      {selectedPlan ? (
        <article className="rounded-md border border-sky-300 bg-sky-50 px-3 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          <p className="font-semibold">Selected early-access plan: {labelForPlan(selectedPlan)}</p>
          <p className="mt-1">
            This step creates your account only. After sign-in, create or open the correct workspace, then launch billing from the in-app billing surface.
          </p>
        </article>
      ) : null}

      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <label htmlFor="org-name" className="text-sm font-medium">
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
          <label htmlFor="email" className="text-sm font-medium">
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
          <label htmlFor="password" className="text-sm font-medium">
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

        {error ? (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating account..." : "Create account"}
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={signInHref} className="font-medium text-foreground underline">
          Sign in
        </Link>
        .
      </p>
    </section>
  );
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <section className="mx-auto w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 text-sm text-muted-foreground shadow-[0_16px_48px_rgba(20,33,43,0.08)]">
          Loading sign-up…
        </section>
      }
    >
      <SignUpForm />
    </Suspense>
  );
}

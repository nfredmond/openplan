"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutState = searchParams.get("checkout");
  const activationState = searchParams.get("activation");
  const redirectTarget = searchParams.get("redirect") ?? "/dashboard";
  const createdState = searchParams.get("created");
  const selectedPlan = searchParams.get("plan") ?? "starter";
  const signUpHref = `/sign-up?plan=${encodeURIComponent(selectedPlan)}&redirect=${encodeURIComponent(redirectTarget)}`;
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

    const nextPath = redirectTarget && redirectTarget.startsWith("/") ? redirectTarget : "/dashboard";
    router.push(nextPath);
    router.refresh();
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6 rounded-2xl border border-border/80 bg-card p-6 shadow-[0_16px_48px_rgba(20,33,43,0.08)] sm:p-8">
      <header className="space-y-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Access your OpenPlan workspace.
        </p>
      </header>

      {createdState === "1" ? (
        <article className="rounded-md border border-sky-300 bg-sky-50 px-3 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          <p className="font-semibold">Account created — next step is your first workspace</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Sign in with the email and password you just created.</li>
            <li>Create or open the correct workspace from Projects.</li>
            <li>
              If you selected {selectedPlan === "starter" ? "Starter" : selectedPlan === "professional" ? "Professional" : "an early-access"} pricing,
              launch billing only after you are inside the correct workspace context.
            </li>
          </ol>
        </article>
      ) : null}

      {checkoutState === "success" ? (
        <article className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="font-semibold">Payment received — here’s what happens next</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Check your email for “Activate your access.”</li>
            <li>If needed, create an account with the same checkout email.</li>
            <li>Activate access, then sign in to your dashboard.</li>
          </ol>
        </article>
      ) : null}

      {checkoutState === "error" || activationState === "error" ? (
        <article className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">We couldn’t confirm activation yet</p>
          <p className="mt-1">
            If a payment attempt failed, no charge was made. If confirmation timed out, duplicate charges are prevented.
          </p>
          <p className="mt-1">Next step: retry checkout once, or contact support if this persists.</p>
        </article>
      ) : null}

      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
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
          <label htmlFor="password" className="text-sm font-medium">
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

        {error ? (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        New to OpenPlan?{" "}
        <Link href={signUpHref} className="font-medium text-foreground underline">
          Create an account
        </Link>
        .
      </p>
    </section>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <section className="mx-auto w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 text-sm text-muted-foreground shadow-[0_16px_48px_rgba(20,33,43,0.08)]">
          Loading sign-in…
        </section>
      }
    >
      <SignInForm />
    </Suspense>
  );
}

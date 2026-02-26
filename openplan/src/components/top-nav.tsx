import Link from "next/link";
import { redirect } from "next/navigation";
import { NavLinkPill } from "@/components/nav/nav-link-pill";
import { createClient } from "@/lib/supabase/server";

export async function TopNav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const navLinks = user
    ? [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/explore", label: "Explore" },
        { href: "/pricing", label: "Pricing" },
        { href: "/billing", label: "Billing" },
      ]
    : [
        { href: "/", label: "Home" },
        { href: "/explore", label: "Explore" },
        { href: "/pricing", label: "Pricing" },
        { href: "/sign-in", label: "Sign in" },
        { href: "/sign-up", label: "Sign up" },
      ];

  async function handleSignOut() {
    "use server";
    const actionSupabase = await createClient();
    await actionSupabase.auth.signOut();
    redirect("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/88 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-border/75 bg-card/75 px-3 py-1.5 transition hover:border-primary/60"
        >
          <span
            className="h-2.5 w-2.5 rounded-full bg-[color:var(--pine)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--pine)_22%,transparent)]"
            aria-hidden
          />
          <span className="text-sm font-semibold tracking-wide">OpenPlan</span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-1.5 rounded-full border border-border/75 bg-card/55 p-1">
          {navLinks.map((link) => (
            <NavLinkPill key={link.href} href={link.href} label={link.label} />
          ))}

          {user ? (
            <form action={handleSignOut}>
              <button
                type="submit"
                className="rounded-full border border-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:border-border/65 hover:bg-muted hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

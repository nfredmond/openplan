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
        { href: "/dashboard", label: "Overview" },
        { href: "/explore", label: "Analysis Studio" },
        { href: "/pricing", label: "Pricing" },
        { href: "/billing", label: "Billing" },
      ]
    : [
        { href: "/", label: "Home" },
        { href: "/explore", label: "App Preview" },
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
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-lg">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        {/* ── Logo pill ── */}
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-full border border-border/70 bg-card/95 px-3.5 py-1.5 shadow-[0_4px_14px_rgba(20,33,43,0.06)] transition-all duration-200 hover:border-[color:var(--pine)]/50 hover:shadow-[0_6px_18px_rgba(20,33,43,0.10)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-2"
        >
          <span
            className="h-2.5 w-2.5 rounded-full bg-[color:var(--pine)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--pine)_18%,transparent)]"
            aria-hidden
          />
          <span className="text-sm font-semibold tracking-[0.06em] text-foreground/90">OpenPlan<span className="hidden sm:inline"> · Planning OS</span></span>
        </Link>

        {/* ── Navigation pills ── */}
        <nav
          aria-label="Primary"
          className="flex items-center gap-1 rounded-full border border-border/60 bg-card/85 p-1 shadow-[0_4px_14px_rgba(20,33,43,0.05)] backdrop-blur-sm"
        >
          {navLinks.map((link) => (
            <NavLinkPill key={link.href} href={link.href} label={link.label} />
          ))}

          {user ? (
            <form action={handleSignOut}>
              <button
                type="submit"
                className="rounded-full border border-transparent px-3 py-1.5 text-sm font-semibold text-foreground/75 transition-colors duration-200 hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-2"
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

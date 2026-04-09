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
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/94 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <Link
            href="/"
            className="flex min-w-0 flex-col gap-1 border-l-2 border-[color:var(--pine)] pl-3 transition-colors hover:border-[color:var(--pine-deep)]"
          >
            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Planning operating system</span>
            <span className="text-lg font-semibold tracking-[0.01em] text-foreground sm:text-[1.1rem]">
              OpenPlan
              <span className="ml-2 text-sm font-medium text-muted-foreground">Civic workbench</span>
            </span>
          </Link>

          <div className="flex flex-col gap-3 lg:min-w-[24rem] lg:items-end">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {user ? "Authenticated workspace" : "Public access lane"}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3 lg:justify-end lg:border-t-0 lg:pt-0">
              <nav aria-label="Primary" className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {navLinks.map((link) => (
                  <NavLinkPill key={link.href} href={link.href} label={link.label} />
                ))}
              </nav>

              {user ? (
                <form action={handleSignOut} className="border-l border-border/60 pl-4">
                  <button
                    type="submit"
                    className="text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-2"
                  >
                    Sign out
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

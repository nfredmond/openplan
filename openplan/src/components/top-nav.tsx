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
        { href: "/pricing", label: "Services" },
        { href: "/billing", label: "Billing" },
      ]
    : [
        { href: "/", label: "Home" },
        { href: "/explore", label: "App Preview" },
        { href: "/pricing", label: "Services" },
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
      <div className="mx-auto grid w-full max-w-[88rem] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)] lg:px-8">
        <Link
          href="/"
          className="grid gap-2 border-l-2 border-[color:var(--pine)] pl-4 transition-colors hover:border-[color:var(--pine-deep)]"
        >
          <span className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Planning operating system</span>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="text-lg font-semibold tracking-[0.01em] text-foreground sm:text-[1.1rem]">OpenPlan</span>
            <span className="text-sm text-muted-foreground">Civic workbench</span>
          </div>
          <span className="max-w-3xl text-sm text-muted-foreground">
            Public entry into the open-source planning workspace, managed-services lane, and share-ready engagement portals.
          </span>
        </Link>

        <div className="grid gap-3 lg:justify-items-end">
          <div className="space-y-1 text-left lg:text-right">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {user ? "Authenticated workspace" : "Public access lane"}
            </p>
            <p className="text-sm text-muted-foreground">
              {user
                ? "Move between the public services surface and the live workspace without dropping planning context."
                : "Review the open-source posture, managed-services options, and live public engagement views before opening the full operator shell."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3 lg:justify-end">
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
    </header>
  );
}

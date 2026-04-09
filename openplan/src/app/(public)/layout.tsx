import Link from "next/link";
import { TopNav } from "@/components/top-nav";

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-[88rem] flex-1 px-4 pb-14 pt-8 sm:px-6 lg:px-8 lg:pt-10">{children}</main>
      <footer className="border-t border-border/60 bg-background/90 backdrop-blur-sm">
        <div className="mx-auto grid w-full max-w-[88rem] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-8">
          <div className="grid gap-2 border-l-2 border-[color:var(--pine)]/50 pl-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">OpenPlan · Nat Ford Planning</p>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Maps, projects, engagement, and report-ready planning work in one connected civic workbench.
            </p>
          </div>
          <div className="grid gap-3 lg:justify-items-end">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-muted-foreground">
              <Link href="/pricing" className="transition hover:text-foreground">
                Pricing
              </Link>
              <Link href="/sign-in" className="transition hover:text-foreground">
                Sign in
              </Link>
              <Link href="/sign-up" className="transition hover:text-foreground">
                Sign up
              </Link>
            </div>
            <p className="text-sm text-muted-foreground lg:text-right">
              Supervised early access for planning teams that need traceable work, not dashboard theater.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

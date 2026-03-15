import Link from "next/link";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-full border border-border/70 bg-card/95 px-3.5 py-1.5 shadow-[0_4px_14px_rgba(20,33,43,0.06)] transition-all duration-200 hover:border-[color:var(--pine)]/50"
          >
            <span
              className="h-2.5 w-2.5 rounded-full bg-[color:var(--pine)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--pine)_18%,transparent)]"
              aria-hidden
            />
            <span className="text-sm font-semibold tracking-[0.06em] text-foreground/90">OpenPlan</span>
          </Link>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Planning OS Access</p>
        </div>
        <div className="flex flex-1 items-center justify-center">{children}</div>
      </div>
    </div>
  );
}

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
            className="inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--line)_70%,var(--pine)_30%)] bg-white/90 px-3.5 py-1.5 shadow-[0_6px_18px_rgba(20,33,43,0.08)] transition hover:border-[color:var(--pine)]"
          >
            <span
              className="h-2.5 w-2.5 rounded-full bg-[color:var(--pine)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--pine)_24%,transparent)]"
              aria-hidden
            />
            <span className="text-sm font-semibold tracking-[0.08em] text-[color:var(--pine-deep)]">OpenPlan</span>
          </Link>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Planning OS Access</p>
        </div>
        <div className="flex flex-1 items-center justify-center">{children}</div>
      </div>
    </div>
  );
}

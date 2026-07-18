import Link from "next/link";

const accessPoints = [
  "Corridor analysis, overlays, and run history stay in one workspace.",
  "Public engagement stays connected to project context and reporting.",
  "Board-ready packets carry their evidence forward with you.",
];

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4 border-b border-border/70 pb-4">
          <Link href="/" className="flex flex-col gap-1 border-l-2 border-[color:var(--pine)] pl-3 transition-colors hover:border-[color:var(--pine-deep)]">
            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Open-source planning workbench</span>
            <span className="text-lg font-semibold tracking-[0.01em] text-foreground">OpenPlan</span>
          </Link>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Your workspace</p>
        </div>

        <main className="grid flex-1 gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(420px,540px)] lg:gap-12">
          <aside className="flex flex-col justify-between gap-8 border-b border-border/60 pb-8 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-10">
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Your workspace</p>
                <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-[3.15rem]">
                  Maps, engagement, and reporting in one planning record.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  OpenPlan is open-source planning software for agencies, tribes, RTPAs, counties, and consulting teams. Sign in to pick up project work, run history, and board-ready packets right where you left them.
                </p>
              </div>

              <div className="border-y border-border/60 bg-background/45">
                {accessPoints.map((point) => (
                  <div key={point} className="border-b border-border/60 px-0 py-3 last:border-b-0">
                    <p className="text-sm text-foreground">{point}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="border-l-2 border-[color:var(--pine)] bg-[color:var(--pine)]/6 px-4 py-3">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">New to OpenPlan?</p>
                <p className="mt-2 text-sm text-foreground">Create an account, then open your workspace to move a planning story from context to a board-ready packet.</p>
              </div>
              <div className="border-l-2 border-[color:var(--copper)] bg-[color:var(--copper)]/10 px-4 py-3">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Why teams use it</p>
                <p className="mt-2 text-sm text-foreground">Analysis, engagement, and deliverables stay tied to the same record, so nothing gets stranded across separate tools.</p>
              </div>
            </div>
          </aside>

          <div className="flex items-start lg:items-center">
            <div className="w-full">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}

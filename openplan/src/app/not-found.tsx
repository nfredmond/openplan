import Link from "next/link";
import { StateBlock } from "@/components/ui/state-block";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <StateBlock
        tone="warning"
        title="That page isn't part of OpenPlan."
        description="The link may be stale, or the workspace surface you asked for does not exist."
        action={
          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href="/"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Return home
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Workspace Dashboard
            </Link>
          </div>
        }
      />
    </main>
  );
}

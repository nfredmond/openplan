import Link from "next/link";
import { StateBlock } from "@/components/ui/state-block";

/**
 * THE PAGE A MISTYPED LINK LANDS ON — and most of the people who land here are
 * members of the public, not users of this software.
 *
 * WHO ACTUALLY ARRIVES. Next.js serves this one file for every unmatched path in
 * the application, which includes `/engage/<token>` with a token typed wrong off
 * a postcard, a flyer, a letter or a QR code that did not scan cleanly. Those
 * residents have no account, have never heard of OpenPlan, and did not ask to
 * meet it. The previous copy told them the page "isn't part of OpenPlan", that
 * "the workspace surface you asked for does not exist", and offered them a
 * "Workspace Dashboard" — three sentences that are all about the software and
 * none about what they can do next.
 *
 * SO THE WORDS ARE WRITTEN FOR THE RESIDENT and the software's own reader is
 * served second. What a person who mistyped a link needs is the single most
 * likely cause (a wrong character) and permission to go and check it; a signed-in
 * user needs their dashboard, which is still one click away, just no longer the
 * thing shouted at somebody holding a postcard.
 *
 * WHAT THIS PAGE MUST NOT DO IS GUESS. It cannot tell a mistyped share token from
 * a link the agency has since switched off, and saying "this consultation has
 * closed" to somebody whose only mistake was a typo would send them away from a
 * consultation that is open. It names both possibilities and neither as fact.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <StateBlock
        tone="warning"
        title="We could not find that page."
        description="The web address may have a small mistake in it, or the page may have been taken down. If you typed it from a postcard, a letter, a flyer or a poster, it is worth checking it once more — one wrong character is enough to end up here."
        detail={
          <p className="text-sm">
            If you were sent this link by a city, county or agency and it still does not work, contact
            them and tell them the address you used. They can send you the right one.
          </p>
        }
        action={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Go to the start page
            </Link>
            {/*
              Kept, and kept working, because this same file answers every bad URL
              inside the signed-in application too — removing it would strand the
              other half of the people who see this page. Demoted to a quiet link
              and named in the first person, so a resident can tell at a glance
              that it is not addressed to them.
            */}
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 items-center text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              If you have an OpenPlan account, open your dashboard
            </Link>
          </div>
        }
      />
    </main>
  );
}

import Link from "next/link";

/**
 * The shell for pages an agency shares with its own public: a draft plan, a
 * measure oversight page, a published land use plan, a review release.
 *
 * WHY THIS ROUTE GROUP EXISTS. These pages used to sit under `(public)`, whose
 * layout puts OpenPlan's own navigation above them and a "Sign up" footer
 * below. A resident reading their county's draft plan is not shopping for
 * planning software, and the offer made the agency's document look like an
 * advertisement. Here the page is the agency's, and OpenPlan gets one quiet
 * line at the bottom.
 *
 * URLS ARE UNCHANGED. A route group's name never appears in a path, so every
 * `/plan/<token>`, `/measure/<token>`, `/published-plans/<id>` and
 * `/review/land-use-plans/<token>` link already sent out still resolves.
 *
 * NO `<main>` HERE, ON PURPOSE. Four of these pages render their own `<main>`
 * and the plan document gets one from its own segment layout, so adding one
 * here would nest two. The wrapper carries `id="main-content"` because the
 * root layout's skip link targets it.
 *
 * `published-reading` is the hook the print stylesheet in `globals.css` uses
 * to print these pages black on white. It has no screen styles.
 */
export default function PublishedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="published-reading flex min-h-dvh flex-col bg-background text-foreground">
      <div id="main-content" tabIndex={-1} className="w-full flex-1">
        {children}
      </div>
      <footer className="published-attribution border-t border-border/60 px-5 py-4 text-center text-sm text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:text-foreground hover:underline">
          Published with OpenPlan, free open-source planning software
        </Link>
      </footer>
    </div>
  );
}

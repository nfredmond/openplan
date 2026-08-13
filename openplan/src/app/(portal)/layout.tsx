/**
 * THE PARTICIPANT SHELL — deliberately empty.
 *
 * WHY THIS ROUTE GROUP EXISTS AT ALL. `(public)/layout.tsx` wraps its children
 * in `<main className="mx-auto w-full max-w-[88rem] flex-1 px-4 pb-14 pt-8">`,
 * under the product's `TopNav` and above a marketing footer whose links are
 * "Sign up" and "Sign in". A nested layout renders INSIDE that `<main>` and
 * cannot escape it, so a full-viewport map was not reachable from there by any
 * amount of CSS that was not a lie about the box model.
 *
 * It also fixed something that was wrong on its own terms: a resident answering
 * their agency's consultation was being footered with an invitation to create an
 * account on planning software. They are not the customer for that, and the
 * offer reads as though the agency is selling something.
 *
 * URLS ARE UNCHANGED. A route group's name never appears in a path, so every
 * postcard, flyer and QR code already printed with `/engage/<token>` still
 * resolves here.
 *
 * `min-h-dvh`, not `min-h-screen`: `vh` includes mobile browser chrome, and this
 * is the surface residents reach on phones.
 *
 * ═══ NO PORTAL PAGE SCROLLS SIDEWAYS ═══
 *
 * `overflow-x-clip` is here rather than on a page, and it is a rule about the
 * whole route group rather than a patch. Measured at 390×844 on
 * `/engage/<token>/about`: `document.scrollWidth` 387 against a `clientWidth` of
 * 375, and the single element responsible was `.public-page-backdrop`, whose
 * `inset: -0.75rem -0.75rem auto` deliberately bleeds 12px past both edges of
 * its column to soften the top of the page. On a desktop column with margin to
 * spare that is invisible; at 390px there is no margin, so the decoration became
 * a horizontal scrollbar and a page that drifts under a thumb.
 *
 * `clip`, never `hidden`: `overflow: hidden` establishes a scroll container and
 * silently breaks `position: sticky` inside it, and the participant surface
 * depends on sticky and `dvh` sizing throughout. `clip` cuts the overflow
 * without creating one.
 *
 * The backdrop's own rule is not touched because it is shared with the
 * marketing pages under `(public)`, which are another lane's; this contains the
 * symptom for every page a RESIDENT can reach, which is what this group is.
 */
export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-dvh overflow-x-clip bg-background text-foreground">{children}</div>;
}

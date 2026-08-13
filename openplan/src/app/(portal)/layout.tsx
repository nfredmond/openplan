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
 */
export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-dvh bg-background text-foreground">{children}</div>;
}

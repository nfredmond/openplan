"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { findNavSection } from "@/components/nav/nav-registry";
import { cn } from "@/lib/utils";

/**
 * The contextual "you are here" panel. It carries NO grouping of its own:
 * findNavSection() resolves the current path to its nav-registry group, so the
 * section title and its members are exactly what the rail and the command
 * palette show. A second, hand-maintained grouping used to live here and had
 * drifted from the rail's — deriving from the registry makes that divergence
 * impossible rather than merely unlikely.
 */
export function AppSecondaryNav() {
  const pathname = usePathname();
  const section = findNavSection(pathname);

  if (!section) {
    return null;
  }

  return (
    <div className="shell-ledger-panel gap-0">
      <p className="shell-panel-kicker">{section.title}</p>
      <ul className="mt-3 divide-y divide-border/60 border-t border-border/60">
        {section.items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  /*
                    The active row used `bg-accent text-foreground`, which
                    borrows shadcn's convention where `--accent` is a MUTED
                    surface. In this token system `--accent` is the saturated
                    brand colour, so the current page rendered as a full-width
                    slab of brand with `--foreground` text on it: near-white on
                    light green under the Meadow palette (~1.3:1), and only
                    ~2:1 on the cartographic default. The most prominent card on
                    the page was also its least readable text.

                    `--secondary` is the panel tint meant for exactly this —
                    a surface that reads as "selected" without competing with
                    the content — and the brand colour moves to a left marker,
                    where it identifies the current row without having to carry
                    text on top of it.
                  */
                  "block rounded border-l-2 px-2 py-1.5 text-[0.8rem] transition-colors duration-150",
                  active
                    ? "border-l-primary bg-secondary text-foreground"
                    : "border-l-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                )}
              >
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                </span>
                {active ? (
                  <span className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-primary">
                    Current
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

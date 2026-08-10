"use client";

import { Check, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTheme } from "@/components/theme-provider";
import type { PaletteDefinition } from "@/lib/theme/palettes";

/**
 * Appearance controls: a labelled light/dark switch and a palette picker.
 *
 * WHY THIS REPLACED A 24px ICON. The only way to change appearance was an
 * unlabelled sun/moon glyph in the rail footer, 14px of stroke inside a 24px
 * hit area, discoverable by hovering the right pixel. Light and dark is the
 * setting a planner reaches for most — in a bright room, on a projector, in a
 * board presentation — and it was the least visible control in the product.
 *
 * The mode switch is a two-option segmented control rather than a toggle,
 * because a toggle has to be read twice: once for the icon and once to work out
 * whether it shows the current state or the action. Two options with one marked
 * current cannot be misread.
 *
 * THE WORDS CAME BACK OFF, and that is not a return to the old glyph. What made
 * the 24px icon undiscoverable was being a lone unlabelled control hidden in a
 * hover-expanding 60px rail — not the absence of the words "Light" and "Dark"
 * beside a sun and a moon. Both options are still shown side by side in the
 * header with the current one filled, so the control still says what it is and
 * which way it is set. Dropping the two labels returns about 70px to a header
 * that also carries the workspace name, the module search and the primary
 * action, where the search pill was being pushed under this control at common
 * window widths. Each button keeps an accessible name.
 */

function swatchFor(palette: PaletteDefinition, mode: "light" | "dark") {
  return mode === "dark" ? palette.swatch.dark : palette.swatch.light;
}

export function ThemeControls({ className = "" }: { className?: string }) {
  const { theme, setTheme, palette, palettes, setPalette } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // The rendered state depends on localStorage, which the server cannot read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!paletteOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!paletteRef.current?.contains(event.target as Node)) setPaletteOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPaletteOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [paletteOpen]);

  // Before mount the stored choice is unknown. Reserving the same footprint
  // keeps the rail from reflowing when the real control appears.
  if (!mounted) {
    return <div className={`h-9 w-full ${className}`} aria-hidden="true" />;
  }

  const activePalette = palettes.find((entry) => entry.id === palette) ?? palettes[0];

  return (
    <div className={`flex flex-col gap-2 ${className}`} data-testid="theme-controls">
      <div
        role="group"
        aria-label="Colour mode"
        className="flex items-center gap-1 rounded-xl border border-border/70 bg-background/70 p-1"
      >
        {(["light", "dark"] as const).map((mode) => {
          const isCurrent = theme === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setTheme(mode)}
              aria-pressed={isCurrent}
              title={mode === "light" ? "Light mode" : "Dark mode"}
              aria-label={mode === "light" ? "Light mode" : "Dark mode"}
              data-testid={`theme-mode-${mode}`}
              className={`flex items-center justify-center rounded-lg px-2.5 py-1.5 transition-colors ${
                isCurrent
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {mode === "light" ? (
                <Sun className="h-4 w-4" strokeWidth={1.9} />
              ) : (
                <Moon className="h-4 w-4" strokeWidth={1.9} />
              )}
            </button>
          );
        })}
      </div>

      {/*
        SAME SHELL AS THE MODE SWITCH, BY CONSTRUCTION.

        The border, background, radius and 4px inset live out here, and the
        button inside is plain — which is exactly how the mode switch above is
        built. The two controls sit side by side in the header, and while the
        palette pill carried its own border it rendered 10px shorter than the
        switch beside it, because it was one padded element where the other was
        a padded box around a padded button.

        Matching the STRUCTURE rather than nudging a padding value is what keeps
        them the same height: a change to the mode switch's inset or icon size
        now moves both, instead of leaving a mismatch for someone to notice in a
        screenshot months later.

        The width is deliberately NOT matched. This control holds an icon and a
        swatch; the switch holds two icons, so it is wider. Stretching this to
        the same width would put back the wide empty pill that the palette NAME
        used to fill — see the note in cartographic.css.
      */}
      <div
        className="relative flex items-center rounded-xl border border-border/70 bg-background/70 p-1"
        ref={paletteRef}
      >
        <button
          type="button"
          onClick={() => setPaletteOpen((open) => !open)}
          aria-expanded={paletteOpen}
          aria-haspopup="listbox"
          data-testid="theme-palette-trigger"
          /*
            The palette NAME is not shown until the menu is open. Knowing you are
            on "Meadow" is worth almost nothing while you are working, and this
            control sits in a header that also has to hold the workspace name, a
            search pill and the primary action — at half a widescreen the label
            cost ~90px and was part of what squeezed the search pill into
            wrapping. The swatch identifies the palette; the name is available
            the moment it could matter, which is when you are choosing.
          */
          title={`Colour palette: ${activePalette.label}`}
          aria-label={`Colour palette: ${activePalette.label}`}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <Palette className="h-4 w-4 shrink-0" strokeWidth={1.9} />
          <span
            aria-hidden="true"
            className="h-4 w-4 shrink-0 rounded-full border border-border/70"
            style={{ background: swatchFor(activePalette, theme).accent }}
          />
        </button>

        {paletteOpen ? (
          <div
            role="listbox"
            aria-label="Colour palette"
            data-testid="theme-palette-list"
            className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-xl border border-border/70 bg-popover p-1.5 shadow-[0_24px_48px_rgba(0,0,0,0.22)]"
          >
            {palettes.map((entry) => {
              const swatch = swatchFor(entry, theme);
              const isCurrent = entry.id === palette;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  data-testid={`theme-palette-${entry.id}`}
                  onClick={() => {
                    setPalette(entry.id);
                    setPaletteOpen(false);
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    isCurrent ? "bg-secondary" : "hover:bg-secondary/60"
                  }`}
                >
                  {/*
                    The preview is drawn from the palette's own colours for the
                    CURRENT mode, so a reader in dark mode is shown the dark
                    version rather than a light chip they will never see.
                  */}
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-6 w-6 shrink-0 overflow-hidden rounded-md border border-border/70"
                    style={{ background: swatch.bg }}
                  >
                    <span className="h-full w-1/2" style={{ background: swatch.accent }} />
                    <span className="h-full w-1/2" style={{ background: swatch.accent2 }} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      {entry.label}
                      {isCurrent ? <Check className="h-3 w-3" strokeWidth={2.4} /> : null}
                    </span>
                    <span className="mt-0.5 block text-[0.68rem] leading-4 text-muted-foreground">
                      {entry.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

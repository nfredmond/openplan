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
 * whether it shows the current state or the action. Two labelled options with
 * one marked current cannot be misread.
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
              data-testid={`theme-mode-${mode}`}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                isCurrent
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {mode === "light" ? (
                <Sun className="h-3.5 w-3.5" strokeWidth={1.9} />
              ) : (
                <Moon className="h-3.5 w-3.5" strokeWidth={1.9} />
              )}
              {mode === "light" ? "Light" : "Dark"}
            </button>
          );
        })}
      </div>

      <div className="relative" ref={paletteRef}>
        <button
          type="button"
          onClick={() => setPaletteOpen((open) => !open)}
          aria-expanded={paletteOpen}
          aria-haspopup="listbox"
          data-testid="theme-palette-trigger"
          className="flex w-full items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <Palette className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="truncate">{activePalette.label}</span>
          <span
            aria-hidden="true"
            className="ml-auto h-3.5 w-3.5 shrink-0 rounded-full border border-border/70"
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

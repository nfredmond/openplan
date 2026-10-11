"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_PALETTE,
  PALETTES,
  normalizePalette,
  type PaletteDefinition,
  type PaletteId,
} from "@/lib/theme/palettes";

type OpenPlanTheme = "light" | "dark";
/**
 * What the reader chose. "system" follows the device setting and is the
 * default (decision D3, October 1, 2026); a stored "light" or "dark" is kept.
 */
type ThemeChoice = OpenPlanTheme | "system";
type SetThemeInput = ThemeChoice | ((current: ThemeChoice) => ThemeChoice);
type SetPaletteInput = PaletteId | ((current: PaletteId) => PaletteId);

type ThemeContextValue = {
  theme: ThemeChoice;
  resolvedTheme: OpenPlanTheme;
  themes: ThemeChoice[];
  setTheme: (theme: SetThemeInput) => void;
  /**
   * The colour palette, which is ORTHOGONAL to light/dark. Each palette
   * supplies both modes, so switching mode never discards the palette and
   * switching palette never flips the mode.
   */
  palette: PaletteId;
  palettes: readonly PaletteDefinition[];
  setPalette: (palette: SetPaletteInput) => void;
};

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: ThemeChoice;
  storageKey?: string;
  paletteStorageKey?: string;
};

const DEFAULT_THEME: ThemeChoice = "system";
const DEFAULT_STORAGE_KEY = "theme";
/**
 * A SEPARATE key from the theme, because they are separate choices. Packing
 * both into one entry would mean a partial write — the shape every
 * `localStorage` value eventually meets — losing the mode and the palette
 * together.
 */
const DEFAULT_PALETTE_STORAGE_KEY = "theme-palette";
const THEMES: ThemeChoice[] = ["system", "light", "dark"];

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  resolvedTheme: "light",
  themes: THEMES,
  setTheme: () => {},
  palette: DEFAULT_PALETTE,
  palettes: PALETTES,
  setPalette: () => {},
});

function normalizeTheme(value: string | null | undefined, fallback: ThemeChoice): ThemeChoice {
  return value === "light" || value === "dark" || value === "system" ? value : fallback;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function deviceTheme(): OpenPlanTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function resolveTheme(choice: ThemeChoice): OpenPlanTheme {
  return choice === "system" ? deviceTheme() : choice;
}

function storedTheme(storageKey: string, fallback: ThemeChoice): ThemeChoice {
  if (typeof window === "undefined") return fallback;
  try {
    return normalizeTheme(window.localStorage.getItem(storageKey), fallback);
  } catch {
    return fallback;
  }
}

function applyTheme(theme: OpenPlanTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

function applyPalette(palette: PaletteId) {
  if (typeof document === "undefined") return;
  // An attribute rather than a class: the palette blocks in globals.css are
  // written as `[data-palette="…"]` so their specificity stays predictable
  // against `.dark`, and one attribute cannot accumulate stale values the way
  // a forgotten classList.remove can.
  document.documentElement.setAttribute("data-palette", palette);
}

function storedPalette(storageKey: string): PaletteId {
  if (typeof window === "undefined") return DEFAULT_PALETTE;
  try {
    return normalizePalette(window.localStorage.getItem(storageKey));
  } catch {
    return DEFAULT_PALETTE;
  }
}

function persistPalette(storageKey: string, palette: PaletteId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, palette);
  } catch {
    // Same reason as the theme: private browsing and locked-down embeds.
  }
}

function persistTheme(storageKey: string, theme: ThemeChoice) {
  if (typeof window === "undefined") return;
  try {
    // "system" is stored as the absence of a choice, so the pre-paint script
    // in layout.tsx needs no third branch to follow the device.
    if (theme === "system") window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, theme);
  } catch {
    // Storage can be unavailable in private browsing or locked-down embeds.
  }
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  storageKey = DEFAULT_STORAGE_KEY,
  paletteStorageKey = DEFAULT_PALETTE_STORAGE_KEY,
}: ThemeProviderProps) {
  const fallbackTheme = normalizeTheme(defaultTheme, DEFAULT_THEME);
  /*
    THE FIRST RENDER MATCHES THE SERVER; THE STORED CHOICE ARRIVES RIGHT AFTER.

    State used to start from localStorage. The server cannot read that, so for a
    light-mode reader every component that rendered from `useTheme()` produced
    different markup on the client than the server sent, and React reported a
    hydration mismatch it does not repair (seen on the model page's charts).
    The document itself is already correct before any of this runs: the script
    in <head> set the class and the palette attribute before first paint. So
    nothing is applied to the document until the stored values are adopted,
    which keeps the first effect from flashing the default over them.
  */
  const [theme, setThemeState] = useState<ThemeChoice>(fallbackTheme);
  const [resolvedTheme, setResolvedTheme] = useState<OpenPlanTheme>("light");
  const [palette, setPaletteState] = useState<PaletteId>(DEFAULT_PALETTE);
  const [adopted, setAdopted] = useState(false);
  const themeRef = useRef(theme);
  const paletteRef = useRef(palette);

  useEffect(() => {
    const nextTheme = storedTheme(storageKey, fallbackTheme);
    const nextPalette = storedPalette(paletteStorageKey);
    themeRef.current = nextTheme;
    paletteRef.current = nextPalette;
    // One-shot adoption of the reader's stored choice after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(nextTheme);
    setPaletteState(nextPalette);
    setAdopted(true);
  }, [fallbackTheme, paletteStorageKey, storageKey]);

  useEffect(() => {
    if (!adopted) return;
    themeRef.current = theme;
    const resolved = resolveTheme(theme);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolvedTheme(resolved);
    applyTheme(resolved);
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    // Following the device: a change of the operating system setting while
    // the page is open repaints it, as it would any native application.
    const query = window.matchMedia(DARK_QUERY);
    const follow = () => {
      const next = query.matches ? "dark" : "light";
      setResolvedTheme(next);
      applyTheme(next);
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [adopted, theme]);

  useEffect(() => {
    if (!adopted) return;
    paletteRef.current = palette;
    applyPalette(palette);
  }, [adopted, palette]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === storageKey) {
        const nextTheme = normalizeTheme(event.newValue, "system");
        themeRef.current = nextTheme;
        setThemeState(nextTheme);
        return;
      }
      // The palette follows the same cross-tab contract as the mode: two open
      // tabs that disagree about the colour of the product is the same defect
      // as two that disagree about light and dark.
      if (event.key === paletteStorageKey) {
        const nextPalette = normalizePalette(event.newValue);
        paletteRef.current = nextPalette;
        setPaletteState(nextPalette);
        applyPalette(nextPalette);
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [fallbackTheme, paletteStorageKey, storageKey]);

  const setTheme = useCallback(
    (input: SetThemeInput) => {
      const nextTheme = normalizeTheme(
        typeof input === "function" ? input(themeRef.current) : input,
        fallbackTheme
      );
      themeRef.current = nextTheme;
      setThemeState(nextTheme);
      persistTheme(storageKey, nextTheme);
    },
    [fallbackTheme, storageKey]
  );

  const setPalette = useCallback(
    (input: SetPaletteInput) => {
      const nextPalette = normalizePalette(
        typeof input === "function" ? input(paletteRef.current) : input
      );
      paletteRef.current = nextPalette;
      setPaletteState(nextPalette);
      persistPalette(paletteStorageKey, nextPalette);
      applyPalette(nextPalette);
    },
    [paletteStorageKey]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      themes: THEMES,
      setTheme,
      palette,
      palettes: PALETTES,
      setPalette,
    }),
    [palette, resolvedTheme, setPalette, setTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

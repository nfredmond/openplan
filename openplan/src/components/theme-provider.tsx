"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PALETTE,
  PALETTES,
  normalizePalette,
  type PaletteDefinition,
  type PaletteId,
} from "@/lib/theme/palettes";

type OpenPlanTheme = "light" | "dark";
type SetThemeInput = OpenPlanTheme | ((current: OpenPlanTheme) => OpenPlanTheme);
type SetPaletteInput = PaletteId | ((current: PaletteId) => PaletteId);

type ThemeContextValue = {
  theme: OpenPlanTheme;
  resolvedTheme: OpenPlanTheme;
  themes: OpenPlanTheme[];
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
  defaultTheme?: OpenPlanTheme;
  storageKey?: string;
  paletteStorageKey?: string;
};

const DEFAULT_THEME: OpenPlanTheme = "dark";
const DEFAULT_STORAGE_KEY = "theme";
/**
 * A SEPARATE key from the theme, because they are separate choices. Packing
 * both into one entry would mean a partial write — the shape every
 * `localStorage` value eventually meets — losing the mode and the palette
 * together.
 */
const DEFAULT_PALETTE_STORAGE_KEY = "theme-palette";
const THEMES: OpenPlanTheme[] = ["light", "dark"];

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  resolvedTheme: DEFAULT_THEME,
  themes: THEMES,
  setTheme: () => {},
  palette: DEFAULT_PALETTE,
  palettes: PALETTES,
  setPalette: () => {},
});

function normalizeTheme(value: string | null | undefined, fallback: OpenPlanTheme): OpenPlanTheme {
  return value === "light" || value === "dark" ? value : fallback;
}

function storedTheme(storageKey: string, fallback: OpenPlanTheme): OpenPlanTheme {
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

function persistTheme(storageKey: string, theme: OpenPlanTheme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, theme);
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
  const [theme, setThemeState] = useState<OpenPlanTheme>(() => storedTheme(storageKey, fallbackTheme));
  const [palette, setPaletteState] = useState<PaletteId>(() => storedPalette(paletteStorageKey));
  const themeRef = useRef(theme);
  const paletteRef = useRef(palette);

  useEffect(() => {
    themeRef.current = theme;
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    paletteRef.current = palette;
    applyPalette(palette);
  }, [palette]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === storageKey) {
        const nextTheme = normalizeTheme(event.newValue, fallbackTheme);
        themeRef.current = nextTheme;
        setThemeState(nextTheme);
        applyTheme(nextTheme);
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
      applyTheme(nextTheme);
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
      resolvedTheme: theme,
      themes: THEMES,
      setTheme,
      palette,
      palettes: PALETTES,
      setPalette,
    }),
    [palette, setPalette, setTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

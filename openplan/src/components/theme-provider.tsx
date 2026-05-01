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

type OpenPlanTheme = "light" | "dark";
type SetThemeInput = OpenPlanTheme | ((current: OpenPlanTheme) => OpenPlanTheme);

type ThemeContextValue = {
  theme: OpenPlanTheme;
  resolvedTheme: OpenPlanTheme;
  themes: OpenPlanTheme[];
  setTheme: (theme: SetThemeInput) => void;
};

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: OpenPlanTheme;
  storageKey?: string;
};

const DEFAULT_THEME: OpenPlanTheme = "dark";
const DEFAULT_STORAGE_KEY = "theme";
const THEMES: OpenPlanTheme[] = ["light", "dark"];

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  resolvedTheme: DEFAULT_THEME,
  themes: THEMES,
  setTheme: () => {},
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
}: ThemeProviderProps) {
  const fallbackTheme = normalizeTheme(defaultTheme, DEFAULT_THEME);
  const [theme, setThemeState] = useState<OpenPlanTheme>(() => storedTheme(storageKey, fallbackTheme));
  const themeRef = useRef(theme);

  useEffect(() => {
    themeRef.current = theme;
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== storageKey) return;
      const nextTheme = normalizeTheme(event.newValue, fallbackTheme);
      themeRef.current = nextTheme;
      setThemeState(nextTheme);
      applyTheme(nextTheme);
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [fallbackTheme, storageKey]);

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

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme: theme,
      themes: THEMES,
      setTheme,
    }),
    [setTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

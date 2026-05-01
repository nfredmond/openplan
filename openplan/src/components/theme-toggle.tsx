"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // One-shot mount gate to avoid hydration mismatch on theme-dependent icon.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return <span className="h-4 w-4" />;
  }

  return (
    <button
      type="button"
      onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      className="flex h-6 w-6 items-center justify-center text-slate-600 transition-colors hover:text-slate-300"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <Sun className="h-3.5 w-3.5" strokeWidth={1.8} />
      ) : (
        <Moon className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
    </button>
  );
}

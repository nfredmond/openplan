import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The type-scale utilities this app adds (`text-label`, `text-compact`,
 * `text-reading`) are font sizes. Without this, tailwind-merge reads an unknown
 * `text-*` class as a text colour and drops it whenever a real colour class
 * follows it in the same `cn()` call, which silently removed the size.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "compact", "reading"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

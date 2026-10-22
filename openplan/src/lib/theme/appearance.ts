import { DEFAULT_PALETTE, PALETTES } from "./palettes";

export const CORNERS = ["rounded", "square"] as const;
export type CornerStyle = (typeof CORNERS)[number];
export const DEFAULT_CORNERS: CornerStyle = "rounded";
export const CORNER_STORAGE_KEY = "theme-corners";

/** Unknown saved choices retain the existing rounded appearance. */
export function normalizeCorners(value: string | null | undefined): CornerStyle {
  return value === "square" ? "square" : DEFAULT_CORNERS;
}

/** Apply independent saved choices before paint, even when storage is blocked. */
export const APPEARANCE_SCRIPT = `(function(){var d=document.documentElement;function read(k){try{return localStorage.getItem(k);}catch(e){return null;}}var t=read("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}d.classList.remove("light","dark");d.classList.add(t);d.style.colorScheme=t;var p=read("theme-palette");d.setAttribute("data-palette",${JSON.stringify(PALETTES.map(({ id }) => id))}.indexOf(p)>-1?p:${JSON.stringify(DEFAULT_PALETTE)});var c=read(${JSON.stringify(CORNER_STORAGE_KEY)});d.setAttribute("data-corners",${JSON.stringify(CORNERS)}.indexOf(c)>-1?c:${JSON.stringify(DEFAULT_CORNERS)});})();`;

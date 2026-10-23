import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { PALETTES, DEFAULT_PALETTE, normalizePalette } from "@/lib/theme/palettes";

const sheets = ["globals", "cartographic", "workspace-gis"].map((name) =>
  postcss.parse(readFileSync(`src/app/${name}.css`, "utf8"))
);
function declarations(selector: string) {
  const values: Record<string, string> = {};
  for (const sheet of sheets) sheet.walkRules(selector, (rule) => {
    let parent: postcss.AnyNode | undefined = rule.parent;
    while (parent) {
      if (parent.type === "atrule" && parent.name === "media") return;
      parent = parent.parent;
    }
    rule.walkDecls((decl) => { values[decl.prop] = decl.value; });
  });
  return values;
}
function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  expect(a).toMatch(/^#[0-9a-f]{6}$/i);
  expect(b).toMatch(/^#[0-9a-f]{6}$/i);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("Signal semantic colors", () => {
  it("adds Signal beside all existing choices and keeps Cartographic as default", () => {
    expect(PALETTES.map(({ id }) => id)).toEqual(["cartographic", "slate", "harbor", "meadow", "plum", "signal"]);
    expect(DEFAULT_PALETTE).toBe("cartographic");
    for (const { id } of PALETTES) expect(normalizePalette(id)).toBe(id);
  });

  it.each(["light", "dark"] as const)("pairs Signal text, filled controls and focus in %s mode", (mode) => {
    const base = mode === "light" ? declarations(":root")
      : declarations(':root:not(.dark) :is(.surface-dark, .module-operator-card, .public-rail),\n.dark');
    const signal = declarations(mode === "light" ? ':root:not(.dark)[data-palette="signal"]' : '.dark[data-palette="signal"]');
    expect(Object.keys(signal).length).toBeGreaterThan(20);
    const values = { ...base, ...signal };
    const resolve = (token: string): string => {
      const value = values[token];
      if (value?.startsWith("var(")) return resolve(value.slice(4, -1));
      return value;
    };
    for (const [ink, background] of [
      ["--foreground", "--background"], ["--muted-foreground", "--card"],
      ["--primary-foreground", "--primary"], ["--accent-foreground", "--accent"],
      ["--secondary-foreground", "--secondary"], ["--pine-ink", "--pine"],
      ["--sidebar-primary-foreground", "--sidebar-primary"],
    ]) {
      expect(contrast(resolve(ink), resolve(background)), `${ink} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const focus of ["--ring", mode === "light" ? "--focus-ring-light" : "--focus-ring-dark"]) {
      for (const background of ["--background", "--card", "--secondary"]) {
        expect(contrast(resolve(focus), resolve(background)), `${focus} on ${background}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const token of ["--urgent", "--warn", "--ok", "--status-urgent", "--status-warn", "--status-ok"]) {
      expect(signal).not.toHaveProperty(token);
    }
  });
});

describe("Square radius scope", () => {
  it("scales shared tokens and actual shell, controls, cards and panels", () => {
    expect(declarations(':root[data-corners="square"]')["--corner-scale"]).toBe("0");
    expect(declarations(":root")["--corner-scale"]).toBe("1");
    const theme: Record<string, string> = {};
    sheets[0].walkAtRules("theme", (rule) => {
      rule.walkDecls((decl) => { theme[decl.prop] = decl.value; });
    });
    for (const token of ["xs", "sm", "md", "xl", "2xl", "3xl", "4xl"]) {
      expect(theme[`--radius-${token}`]).toContain("var(--corner-scale)");
    }
    expect(theme["--radius-lg"]).toBe("var(--radius)");
    expect(declarations(":root")["--radius"]).toContain("var(--corner-scale)");
    for (const selector of [".op-cart-pill", ".op-cart-btn", ".op-cart-surface", ".op-cart-rail", ".workspace-module-surface", ".module-operator-card", ".analysis-sidepanel-select", ".op-gis-wizard"]) {
      expect(declarations(selector)["border-radius"], selector).toContain("var(--corner-scale)");
    }
  });

  it("covers audited fixed-radius utilities and padded pills without resetting symbols", () => {
    let selector = "";
    sheets[0].walkRules((rule) => {
      if (rule.selector.startsWith(':root[data-corners="square"] :is(')) {
        selector = rule.selector;
        expect(rule.nodes.find((node) => node.type === "decl" && node.prop === "border-radius")).toMatchObject({ value: "0" });
      }
    });
    for (const length of ["0.25rem", "0.3rem", "0.35rem", "0.4rem", "0.45rem", "0.5rem", "0.55rem", "0.6rem", "0.75rem", "1.7rem", "12px", "14px", "18px", "20px"]) {
      expect(selector).toContain(`[class~="rounded-[${length}]"]`);
    }
    expect(selector).toContain('[class~="sm:rounded-[0.6rem]"]');
    expect(selector).toContain('.rounded-full:is([class*="px-"], [class~="p-1"], [class~="p-2"])');
    expect(selector).not.toMatch(/\]\s+\*|:is\(\s*\*/);
  });

  it("retains avatar, map legend and status-dot geometry", () => {
    for (const [selector, radius] of [
      [".op-cart-inspector__avatar", "10px"], [".op-cart-legend__swatch", "3px"],
      [".op-cart-layer-item__swatch", "2px"], [".op-gis-layer__swatch", "3px"],
      [".analysis-workspace-layer__swatch", "0.2rem"], [".module-run-history-bridge-dot", "999px"],
    ]) expect(declarations(selector)["border-radius"], selector).toBe(radius);
  });
});

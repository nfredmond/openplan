import { existsSync } from "node:fs";
import path from "node:path";

export function getMarkdownSection(markdown: string, heading: string) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^##\\s+${escapedHeading}\\s*$`, "m");
  const match = headingPattern.exec(markdown);

  if (!match || match.index === undefined) {
    return "";
  }

  const start = match.index;
  const rest = markdown.slice(start + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  const end = nextHeading?.index === undefined ? markdown.length : start + match[0].length + nextHeading.index;

  return markdown.slice(start, end).trim();
}

export function extractMarkdownTableRows(section: string) {
  const tableLines = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (tableLines.length < 3) {
    return [];
  }

  return tableLines.slice(2).map((line) =>
    line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim()),
  );
}

export function markdownLinks(markdown: string) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
}

export function unresolvedLocalMarkdownLinks(documentPath: string, markdown: string) {
  return markdownLinks(markdown).flatMap((link) => {
    const target = link.split("#")[0];

    if (!target || /^https?:/i.test(target) || /^mailto:/i.test(target)) {
      return [];
    }

    const resolvedPath = path.resolve(path.dirname(documentPath), target);
    return existsSync(resolvedPath) ? [] : [`${link} -> ${resolvedPath}`];
  });
}

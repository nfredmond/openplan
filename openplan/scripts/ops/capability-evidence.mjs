import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Validate the dated, exact-byte records behind proven coverage cells.
 * This checks custody and review dates; a reviewer must still judge whether
 * the referenced record proves the claimed planning outcome and coverage.
 * @param {{reviewedAt: string, dimensions: Record<string, Array<{id: string, status: string, reviewedAt?: string, evidence?: Array<{path: string, sha256: string}>}>>}} registry
 * @param {string} repoRoot
 * @param {string} today
 */
export function validateCapabilityEvidence(registry, repoRoot, today) {
  const root = realpathSync(repoRoot);
  for (const [dimension, cells] of Object.entries(registry.dimensions)) {
    for (const cell of cells) {
      if (cell.status !== "proven") continue;
      const label = `proven cell ${dimension}/${cell.id}`;
      const reviewedAt = cell.reviewedAt;
      const date = new Date(`${reviewedAt}T00:00:00Z`);
      if (
        typeof reviewedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt) ||
        Number.isNaN(date.valueOf()) ||
        date.toISOString().slice(0, 10) !== reviewedAt ||
        reviewedAt < registry.reviewedAt ||
        reviewedAt > today
      ) {
        throw new Error(`${label} needs a valid review date within the current registry review period`);
      }
      if (!Array.isArray(cell.evidence) || cell.evidence.length === 0) {
        throw new Error(`${label} has no evidence records`);
      }
      const seen = new Set();
      for (const evidence of cell.evidence) {
        if (!evidence || typeof evidence.path !== "string" || !evidence.path.trim() || isAbsolute(evidence.path)) {
          throw new Error(`${label} needs a repository-relative evidence path`);
        }
        let source;
        try {
          source = realpathSync(resolve(root, evidence.path));
          if (!statSync(source).isFile()) throw new Error("not a file");
        } catch {
          throw new Error(`${label} evidence file is missing: ${evidence.path}`);
        }
        const local = relative(root, source);
        if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
          throw new Error(`${label} evidence must stay inside the repository: ${evidence.path}`);
        }
        if (seen.has(source)) throw new Error(`${label} repeats evidence: ${evidence.path}`);
        seen.add(source);
        if (!/^[0-9a-f]{64}$/.test(evidence.sha256 ?? "")) {
          throw new Error(`${label} evidence needs a lowercase SHA-256: ${evidence.path}`);
        }
        const actual = createHash("sha256").update(readFileSync(source)).digest("hex");
        if (actual !== evidence.sha256) {
          throw new Error(`${label} evidence hash changed: ${evidence.path}`);
        }
      }
    }
  }
}

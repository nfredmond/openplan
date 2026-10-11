#!/usr/bin/env node
// The transportation-gis skill ships inside this checkout. A run copies it into
// the run folder only after its files match MANIFEST.json, and the app names
// the tree hash it expects, so a package always records which kit built it.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAP_PACKAGE_SKILL_NAME = "transportation-gis";
export const MAP_PACKAGE_SKILL_PARENT = join(dirname(fileURLToPath(import.meta.url)), "map-package-skill");
export const MAP_PACKAGE_SKILL_ROOT = join(MAP_PACKAGE_SKILL_PARENT, MAP_PACKAGE_SKILL_NAME);
export const MAP_PACKAGE_SKILL_MANIFEST = join(MAP_PACKAGE_SKILL_PARENT, "MANIFEST.json");

export class SkillManifestError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function listFiles(root, directory = root, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === "__pycache__") continue;
    if (entry.isSymbolicLink()) throw new SkillManifestError("skill_symlink_refused");
    if (entry.isDirectory()) await listFiles(root, path, found);
    else if (entry.isFile()) found.push(relative(root, path).split(sep).join("/"));
    else throw new SkillManifestError("skill_entry_refused");
  }
  return found;
}

/** Every file under `root` with its sha256, sorted by path, and one tree hash over the list. */
export async function buildSkillManifest(root = MAP_PACKAGE_SKILL_ROOT) {
  const info = await lstat(root);
  if (!info.isDirectory()) throw new SkillManifestError("skill_missing");
  const paths = (await listFiles(root)).sort();
  const files = [];
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    files.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const treeHash = createHash("sha256").update(files.map(file => `${file.sha256}  ${file.path}\n`).join("")).digest("hex");
  return { schemaVersion: 1, skill: MAP_PACKAGE_SKILL_NAME, treeHash, files };
}

/** The recorded manifest, after checking that the files on disk still match it. */
export async function verifiedSkillManifest(root = MAP_PACKAGE_SKILL_ROOT, manifestPath = MAP_PACKAGE_SKILL_MANIFEST) {
  const recorded = JSON.parse(await readFile(manifestPath, "utf8"));
  const current = await buildSkillManifest(root);
  if (JSON.stringify(recorded) !== JSON.stringify(current)) throw new SkillManifestError("skill_manifest_mismatch");
  return current;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== "write") {
    process.stderr.write("usage: map-package-skill.mjs write\n");
    process.exitCode = 1;
  } else {
    const manifest = await buildSkillManifest();
    await writeFile(MAP_PACKAGE_SKILL_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`${manifest.files.length} files, tree ${manifest.treeHash}\n`);
  }
}

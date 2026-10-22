import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { testedCliRecord } from "./tested-cli-versions.mjs";

const PACKAGES = { codex: "@openai/codex", claude: "@anthropic-ai/claude-code", opencode: "opencode-ai" };
const ENTRIES = { codex: "codex", claude: "claude", opencode: "opencode" };

function within(root, path) {
  const suffix = relative(root, path);
  return suffix !== "" && !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../");
}

// Inspect an operator-declared npm root and its matching package entry. Layout
// alone cannot distinguish npm from another manager; never guess the installer.
// No binary, package manager, profile, network request or update runs here.
export async function installerGuidance({ provider, binaryPath, installer = null, npmGlobalRoot = null, platform = process.platform }) {
  const record = testedCliRecord(provider);
  const unknown = reason => ({ schemaVersion: 1, provider, testedVersion: record.version,
    installer: "unknown", ownership: "unverified", reason, installedPackageVersion: null,
    command: null, executesUpdate: false });
  if (platform !== "linux") return unknown("platform_unsupported");
  if (installer !== "npm") return unknown("installer_not_verified");
  if (typeof binaryPath !== "string" || !isAbsolute(binaryPath) ||
      typeof npmGlobalRoot !== "string" || !isAbsolute(npmGlobalRoot)) return unknown("installation_path_invalid");
  let file;
  try {
    const root = await realpath(npmGlobalRoot);
    if (basename(root) !== "node_modules" || basename(dirname(root)) !== "lib" || dirname(dirname(root)) === "/") return unknown("package_layout_unsupported");
    const packagePath = join(root, PACKAGES[provider]);
    const packageStat = await lstat(packagePath);
    if (!packageStat.isDirectory() || packageStat.isSymbolicLink() || await realpath(packagePath) !== packagePath) return unknown("package_link_unsupported");
    file = await open(join(packagePath, "package.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 65_536) return unknown("package_metadata_invalid");
    const bytes = Buffer.alloc(65_537);
    const read = await file.read(bytes, 0, bytes.length, 0);
    const after = await file.stat();
    if (read.bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) return unknown("package_metadata_changed");
    const metadata = JSON.parse(bytes.subarray(0, read.bytesRead).toString("utf8"));
    if (metadata.name !== PACKAGES[provider] || typeof metadata.version !== "string" ||
        !/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[a-zA-Z0-9.-]{1,50})?$/.test(metadata.version)) return unknown("package_metadata_invalid");
    const entry = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.[ENTRIES[provider]];
    if (typeof entry !== "string" || entry.length > 512 || isAbsolute(entry) || entry.split(/[\\/]/).includes("..")) return unknown("package_entry_invalid");
    const declaredEntry = join(packagePath, entry);
    const resolvedEntry = await realpath(declaredEntry);
    if (!within(packagePath, declaredEntry) || !within(packagePath, resolvedEntry) ||
        resolvedEntry !== await realpath(binaryPath) || !(await lstat(resolvedEntry)).isFile()) return unknown("binary_entry_mismatch");
    return { schemaVersion: 1, provider, testedVersion: record.version, installer: "npm",
      ownership: "operator_declared_entry_verified", reason: null, installedPackageVersion: metadata.version,
      command: { executable: "npm", args: ["install", "--global", "--prefix", dirname(dirname(root)), `${PACKAGES[provider]}@${record.version}`] },
      executesUpdate: false };
  } catch {
    return unknown("installation_unreadable");
  } finally {
    await file?.close();
  }
}

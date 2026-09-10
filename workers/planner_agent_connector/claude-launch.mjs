import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import { join, isAbsolute, parse } from "node:path";

export const CLAUDE_PROTOCOL_VERSION = "2.1.263";

// Native Claude owns credential reads and atomic refresh. Other profile entries
// are masked inside the child; the user's settings, skills and history stay put.
export async function claudeLaunch({ binaryPath, providerHome, scratchPath, modelProvider }) {
  if (process.platform !== "linux") throw new Error("native_platform_unsupported");
  if (![binaryPath, providerHome, scratchPath].every(path => typeof path === "string" && isAbsolute(path))) {
    throw new Error("native_path_invalid");
  }
  const binary = await realpath(binaryPath);
  const version = await promisify(execFile)(binary, ["--version"], {
    timeout: 5000, maxBuffer: 8192, env: { PATH: "/usr/bin:/bin" },
  }).catch(() => { throw new Error("native_version_unavailable"); });
  if (version.stdout.trim() !== `${CLAUDE_PROTOCOL_VERSION} (Claude Code)`) throw new Error("native_version_unsupported");
  const profile = await realpath(providerHome), scratch = await realpath(scratchPath);
  if (profile === parse(profile).root || scratch === profile || scratch.startsWith(`${profile}/`) || profile.startsWith(`${scratch}/`)) {
    throw new Error("native_path_invalid");
  }
  const credential = await lstat(join(profile, ".credentials.json")).catch(() => null);
  if (credential && (!credential.isFile() || credential.isSymbolicLink() || credential.uid !== process.getuid() || (credential.mode & 0o077) !== 0)) {
    throw new Error("native_credentials_not_private");
  }
  // Managed policy can supply tools/hooks and authentication requirements. This
  // first local adapter refuses that untested environment rather than masking it.
  if (await lstat("/etc/claude-code").catch(() => null)) throw new Error("native_managed_policy_unsupported");
  const entries = await readdir(profile, { withFileTypes: true });
  if (entries.length > 512) throw new Error("native_profile_too_large");
  const masks = join(scratch, "profile-masks");
  await mkdir(masks, { mode: 0o700 });
  const args = ["--die-with-parent", "--unshare-pid", "--unshare-ipc", "--unshare-uts",
    "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--ro-bind", binary, "/runtime/claude", "--bind", profile, "/provider",
    "--bind", scratch, "/work", "--dir", "/home/openplan", "--chdir", "/work"];
  for (const path of ["/etc/ssl", "/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/passwd", "/etc/group", "/etc/localtime"]) {
    if (await lstat(path).catch(() => null)) args.push("--ro-bind", path, path);
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.name === ".credentials.json") continue;
    const mask = join(masks, String(index));
    if (entry.isDirectory()) await mkdir(mask, { mode: 0o700 });
    // Native global JSON is parsed even in safe mode. A valid empty object
    // hides its contents without turning a repeated connection into corruption.
    else if (entry.isFile()) await writeFile(mask, entry.name.endsWith(".json") ? "{}" : "", { mode: 0o600 });
    else throw new Error("native_profile_entry_unsupported");
    args.push("--bind", mask, `/provider/${entry.name}`);
  }
  args.push("--", "/runtime/claude", "--safe-mode");
  const env = { PATH: "/usr/bin:/bin", HOME: "/home/openplan", CLAUDE_CONFIG_DIR: "/provider",
    LANG: "C.UTF-8", TMPDIR: "/tmp", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_FAST_MODE: "1" };
  if (modelProvider) {
    // Only installed-native tests supply a loopback response fixture. Public
    // connector configuration has no endpoint or environment override field.
    const url = new URL(modelProvider);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("native_fixture_origin_invalid");
    }
    env.ANTHROPIC_BASE_URL = url.origin;
  }
  return { command: "/usr/bin/bwrap", args, options: {
    cwd: scratch, shell: false, stdio: ["pipe", "pipe", "pipe"],
    env,
  } };
}

// The frozen packet is stdin, not a shell argument. No inherited tool, MCP,
// plugin, browser or permission handler may acquire authority for this task.
export function claudeTurnArgs({ model, instructions, outputSchema }) {
  return ["--print", "--output-format", "stream-json", "--verbose",
    "--model", model, "--system-prompt", instructions,
    "--json-schema", JSON.stringify(outputSchema), "--tools", "",
    "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--no-chrome", "--no-session-persistence", "--max-turns", "2"];
}

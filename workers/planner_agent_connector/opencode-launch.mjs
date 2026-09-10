import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, lstat, mkdir } from "node:fs/promises";
import { join, isAbsolute, parse } from "node:path";

export const OPENCODE_PROTOCOL_VERSION = "1.18.30";

// This first adapter supports native OpenAI API credentials only. Mount the
// native auth file read-only; OAuth refresh and other account modes are refused.
// History, project files, configuration, plugins and caches are never mounted.
export async function openCodeLaunch({ binaryPath, providerHome, scratchPath, relayUrl, serverPassword }) {
  if (process.platform !== "linux") throw new Error("native_platform_unsupported");
  if (![binaryPath, providerHome, scratchPath].every(path => typeof path === "string" && isAbsolute(path))) {
    throw new Error("native_path_invalid");
  }
  if (typeof serverPassword !== "string" || !/^[a-f0-9]{64}$/.test(serverPassword)) throw new Error("native_server_secret_invalid");
  let relay;
  try { relay = new URL(relayUrl); } catch { throw new Error("native_relay_origin_invalid"); }
  if (relay.protocol !== "http:" || relay.hostname !== "127.0.0.1" || !relay.port || relay.username || relay.password ||
    relay.search || relay.hash || !/^\/[a-f0-9]{64}$/.test(relay.pathname)) throw new Error("native_relay_origin_invalid");
  const binary = await realpath(binaryPath);
  const version = await promisify(execFile)(binary, ["--version"], {
    timeout: 5000, maxBuffer: 8192, env: { PATH: "/usr/bin:/bin" },
  }).catch(() => { throw new Error("native_version_unavailable"); });
  if (version.stdout.trim() !== OPENCODE_PROTOCOL_VERSION) throw new Error("native_version_unsupported");
  const profile = await realpath(providerHome), scratch = await realpath(scratchPath);
  if (profile === parse(profile).root || scratch === parse(scratch).root || profile === scratch ||
    profile.startsWith(`${scratch}/`) || scratch.startsWith(`${profile}/`) ||
    !(await lstat(profile)).isDirectory() || !(await lstat(scratch)).isDirectory()) throw new Error("native_path_invalid");
  const authPath = join(profile, "auth.json"), auth = await lstat(authPath).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (auth && (!auth.isFile() || auth.isSymbolicLink() || auth.uid !== process.getuid() || (auth.mode & 0o077) !== 0 || auth.size > 256_000)) {
    throw new Error("native_credentials_not_private");
  }
  // Exclusive mkdir refuses reused runtime state even if the caller supplied a
  // populated scratch directory. Only this new child is visible to the native CLI.
  const runtime = join(scratch, "opencode-runtime");
  await mkdir(runtime, { mode: 0o700 });
  await mkdir(join(runtime, "data/opencode"), { recursive: true, mode: 0o700 });
  await mkdir(join(runtime, "task"), { mode: 0o700 });
  const args = ["--die-with-parent", "--unshare-pid", "--unshare-ipc", "--unshare-uts",
    "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--ro-bind", binary, "/runtime/opencode", "--bind", runtime, "/work",
    "--dir", "/home/openplan", "--chdir", "/work/task"];
  if (auth) args.push("--ro-bind", authPath, "/work/data/opencode/auth.json");
  for (const path of ["/etc/ssl", "/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/passwd", "/etc/group", "/etc/localtime"]) {
    if (await lstat(path).catch(() => null)) args.push("--ro-bind", path, path);
  }
  args.push("--", "/runtime/opencode", "--pure");
  const permission = { "*": "deny", StructuredOutput: "allow" };
  const config = {
    share: "disabled", autoupdate: false, snapshot: false, permission,
    mcp: {}, plugin: [], instructions: [], lsp: false, formatter: false,
    enabled_providers: ["openai"], compaction: { auto: false, prune: false },
    provider: { openai: { options: { baseURL: relay.href, timeout: 120_000 } } },
    agent: { title: { disable: true }, summary: { disable: true }, compaction: { disable: true },
      openplan: { mode: "primary", prompt: "Use only the frozen OpenPlan project packet. Proposals do not change records.", permission, steps: 2 } },
  };
  return { command: "/usr/bin/bwrap", args, options: {
    cwd: runtime, shell: false, stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", HOME: "/home/openplan", LANG: "C.UTF-8", TMPDIR: "/tmp",
      XDG_DATA_HOME: "/work/data", XDG_CONFIG_HOME: "/work/config", XDG_CACHE_HOME: "/work/cache", XDG_STATE_HOME: "/work/state",
      OPENCODE_SERVER_PASSWORD: serverPassword, OPENCODE_SERVER_USERNAME: "openplan",
      OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_EMBEDDED_WEB_UI: "1", OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
  } };
}

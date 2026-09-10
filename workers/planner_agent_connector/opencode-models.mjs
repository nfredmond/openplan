import { spawn } from "node:child_process";
import { openCodeModelCatalog } from "./opencode-account.mjs";
import { OpenCodeProcessError } from "./opencode-process.mjs";

// This is a non-generating command in its own network namespace. Resolve only
// after the owned child exits so the caller can remove its credential snapshot.
export async function inspectOpenCodeModels(launch, { signal, timeoutMs = 15_000 } = {}) {
  if (signal?.aborted) throw new OpenCodeProcessError("native_cancelled");
  if (launch.account?.status !== "connected" || launch.account.authMode !== "opencode_api") {
    throw new OpenCodeProcessError("native_account_unavailable");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, ["--unshare-net", ...launch.args, "models", "openai"], launch.options);
    let failure, bytes = 0, stderrBytes = 0; const chunks = [];
    const fail = code => { failure ??= new OpenCodeProcessError(code); child.kill("SIGKILL"); };
    const abort = () => fail("native_cancelled");
    const timer = setTimeout(() => fail("native_timeout"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdin.on("error", () => { /* Exit determines a closed input pipe. */ });
    child.stdin.end();
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 100_000) fail("native_output_too_large");
      else if (!failure) chunks.push(chunk);
    });
    child.stderr.on("data", chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65_536) fail("native_stderr_too_large");
    });
    child.on("error", () => fail("native_process_unavailable"));
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0 || exitSignal) reject(new OpenCodeProcessError("native_process_failed"));
      else {
        try { resolve(openCodeModelCatalog(Buffer.concat(chunks).toString("utf8"))); }
        catch (error) { reject(error); }
      }
    });
    if (signal?.aborted) abort();
  });
}

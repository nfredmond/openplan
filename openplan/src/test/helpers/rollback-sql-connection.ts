import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { requireContractVerificationStack } from "./contract-verification-stack";

/** One owned psql session permits explicit transaction barriers without committing synthetic fixtures. */
export function rollbackSqlConnection(container: string) {
  requireContractVerificationStack(container);
  const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  let stderr = "", serial = 0, closed = false;
  let pending: { marker: string; lines: string[]; resolve: (rows: string[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  child.stderr.on("data", bytes => { stderr += String(bytes); });
  lines.on("line", line => {
    if (!pending) return;
    if (line === pending.marker) {
      const done = pending; pending = null; clearTimeout(done.timer); done.resolve(done.lines);
    } else if (line) pending.lines.push(line);
  });
  const ended = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => {
      closed = true;
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`Native SQL session ended: ${stderr}`)); pending = null; }
      if (code === 0) resolve(); else reject(new Error(`Native SQL session failed: ${stderr}`));
    });
  });
  void ended.catch(() => undefined);
  return {
    query: (sql: string) => {
      if (pending || closed) throw new Error("Native SQL session is busy or closed");
      return new Promise<string[]>((resolve, reject) => {
        const marker = `native-rollback-query-${++serial}`;
        const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Native SQL query timed out")); }, 40_000);
        pending = { marker, lines: [], resolve, reject, timer };
        child.stdin.write(sql + `\n\\echo ${marker}\n`);
      });
    },
    close: async () => {
      if (!closed) child.stdin.end("ROLLBACK;\n\\q\n");
      await ended; lines.close();
    },
  };
}

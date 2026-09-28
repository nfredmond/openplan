import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ exec: vi.fn(), spawn: vi.fn(), wrongOwner: false, restoreFailure: false, marker: "", database: "" }));
vi.mock("node:child_process", () => ({ execFileSync: m.exec, spawn: m.spawn, default: { execFileSync: m.exec, spawn: m.spawn } }));
import { assertSynthesisProbeDatabase, withSynthesisProbeDatabase } from "./helpers/synthesis-probe-database";
import { rollbackSqlConnection } from "./helpers/rollback-sql-connection";
const container = "supabase_db_m11-contract-verification";

beforeEach(() => {
  vi.clearAllMocks(); m.wrongOwner = false; m.restoreFailure = false; m.marker = ""; m.database = "";
  m.exec.mockImplementation((command: string, args: string[]) => {
    expect(command).toBe("docker");
    if (args.includes("pg_dump")) { expect(args).toContain("--schema-only"); return Buffer.from("SYNTHETIC schema archive"); }
    if (args.includes("createdb")) { m.database = args.at(-1)!; return Buffer.alloc(0); }
    if (args.includes("pg_restore")) { expect(args[args.indexOf("-d") + 1]).toBe(m.database); expect(args).toContain("--schema-only"); expect(args).toContain("--exit-on-error"); expect(args).toContain("--single-transaction"); if (m.restoreFailure) throw new Error("SYNTHETIC restore failed"); return Buffer.alloc(0); }
    if (args.includes("dropdb")) { expect(args.at(-1)).toBe(m.database); expect(args).not.toContain("--force"); expect(args).not.toContain("-f"); return Buffer.alloc(0); }
    const sql = args.at(-1)!;
    if (sql.startsWith("COMMENT ON DATABASE")) { m.marker = sql.split("'")[1]; return ""; }
    if (sql.startsWith("SELECT shobj_description")) return m.wrongOwner ? "foreign marker" : m.marker;
    throw new Error("Unexpected process call");
  });
  m.spawn.mockImplementation(() => {
    const child = new EventEmitter();
    return Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: { end: () => queueMicrotask(() => child.emit("close", 0)) } });
  });
});

describe("owned synthesis database boundaries", () => {
  it("copies schema and cleans up only its marked database", async () => {
    await withSynthesisProbeDatabase(container, async database => {
      expect(database).toMatch(/^openplan_synthesis_probe_[a-f0-9]{32}$/); expect(database).toBe(m.database);
      expect(m.exec.mock.calls.some(([, args]) => args.includes("dropdb"))).toBe(false);
    });
    expect(m.exec.mock.calls.filter(([, args]) => args.includes("dropdb"))).toHaveLength(1);
  });
  it("cleans up its marked database when the probe fails", async () => {
    await expect(withSynthesisProbeDatabase(container, async () => { throw new Error("SYNTHETIC probe failed"); })).rejects.toThrow("SYNTHETIC probe failed");
    expect(m.exec.mock.calls.filter(([, args]) => args.includes("dropdb"))).toHaveLength(1);
  });
  it("leaves an unmarked database untouched if its marker cannot be saved", async () => {
    const implementation = m.exec.getMockImplementation()!;
    m.exec.mockImplementation((command: string, args: string[]) => {
      if (args.at(-1)?.startsWith("COMMENT ON DATABASE")) throw new Error("SYNTHETIC marker failed");
      return implementation(command, args);
    });
    await expect(withSynthesisProbeDatabase(container, async () => undefined)).rejects.toThrow("SYNTHETIC marker failed");
    expect(m.exec.mock.calls.some(([, args]) => args.includes("dropdb"))).toBe(false);
  });
  it("refuses a changed cleanup owner", async () => {
    await expect(withSynthesisProbeDatabase(container, async () => { m.wrongOwner = true; })).rejects.toThrow("Refusing cleanup without the original ownership marker");
    expect(m.exec.mock.calls.some(([, args]) => args.includes("dropdb"))).toBe(false);
  });
  it("cleans up its marked database after a restore failure", async () => {
    m.restoreFailure = true;
    await expect(withSynthesisProbeDatabase(container, async () => { throw new Error("callback must not run"); })).rejects.toThrow("SYNTHETIC restore failed");
    expect(m.exec.mock.calls.filter(([, args]) => args.includes("dropdb"))).toHaveLength(1);
  });
  it("refuses an unrelated database stack before running a process", async () => {
    await expect(withSynthesisProbeDatabase("supabase_db_demo", async () => undefined)).rejects.toThrow("explicitly named disposable");
    expect(m.exec).not.toHaveBeenCalled();
  });
  it.each(["postgres", "template1", "openplan_synthesis_probe_existing", "openplan_synthesis_probe_'unsafe"])("refuses unsafe disposable name %s", name => {
    expect(() => assertSynthesisProbeDatabase(name)).toThrow("Expected an owned synthesis probe database");
  });
  it.each(["postgres", "openplan_synthesis_probe_0123456789abcdef0123456789abcdef"])("connects only to the explicit allowed target %s", async database => {
    const connection = rollbackSqlConnection(container, database); await connection.close();
    expect(m.spawn.mock.calls[0][1]).toContain(database);
    const args = m.spawn.mock.calls[0][1] as string[]; expect(args[args.indexOf("-d") + 1]).toBe(database);
  });
  it("defaults the rollback connection to postgres", async () => {
    const connection = rollbackSqlConnection(container); await connection.close();
    const args = m.spawn.mock.calls[0][1] as string[]; expect(args[args.indexOf("-d") + 1]).toBe("postgres");
  });
  it("refuses an unrelated SQL target before starting psql", () => {
    expect(() => rollbackSqlConnection(container, "other_database")).toThrow("Expected an owned synthesis probe database");
    expect(m.spawn).not.toHaveBeenCalled();
  });
});

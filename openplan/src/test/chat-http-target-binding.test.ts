// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertChatHttpTargetBinding, type ChatHttpTargetEvidence } from "./helpers/chat-http-target-binding";

// Sanitized CLI 2.111.0 Go/TS shapes. No Docker, SQL, keys, or HTTP calls.
function evidence(labeled = false): ChatHttpTargetEvidence {
  const workdir = "/isolated/openplan";
  const container = (service: string, port: string, hostPort: string) => ({
    Name: `/supabase_${service}_openplan`,
    Config: { Labels: { "com.supabase.cli.project": "openplan", "com.docker.compose.project": "openplan",
      ...(labeled ? { "com.supabase.cli.workdir": workdir } : {}) } },
    State: { Running: true },
    NetworkSettings: { Ports: { [port]: [{ HostIp: "0.0.0.0", HostPort: hostPort }] },
      Networks: { supabase_network_openplan: { NetworkID: "synthetic-network-id" } } },
  });
  return { workdir, configPath: `${workdir}/supabase/config.toml`,
    configText: '# No project_id: CLI uses the workdir basename.\n[api]\nport = 54321\n[db]\nport = 54322\n',
    status: { API_URL: "http://127.0.0.1:54321", DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54322/postgres" },
    container: "supabase_db_openplan", database: container("db", "5432/tcp", "54322"), gateway: container("kong", "8000/tcp", "54321") };
}

type Fault = [string, (input: ChatHttpTargetEvidence) => void, string];
const faults: Fault[] = [
  ["relative workdir", f => { f.workdir = "openplan"; }, "workdir/config mismatch"],
  ["wrong workdir", f => { f.workdir = "/other/openplan"; }, "workdir/config mismatch"],
  ["wrong config path", f => { f.configPath = "/other/openplan/supabase/config.toml"; }, "workdir/config mismatch"],
  ["wrong project config", f => { f.configText = 'project_id = "other"\n' + f.configText; }, "project name mismatch"],
  ["empty project after sanitization", f => { f.configText = 'project_id = "---"\n' + f.configText; }, "missing project identity"],
  ["nonstring project", f => { f.configText = 'project_id = 3\n' + f.configText; }, "invalid project identity"],
  ["missing config ports", f => { f.configText = "[api]\n[db]\n"; }, "missing API/DB ports"],
  ["missing config sections", f => { f.configText = ""; }, "missing API/DB config"],
  ["wrong configured DB port", f => { f.configText = f.configText.replace("54322", "55322"); }, "status/config port mismatch"],
  ["wrong status DB port", f => { f.status.DB_URL = f.status.DB_URL.replace("54322", "55322"); }, "status/config port mismatch"],
  ["wrong status API port", f => { f.status.API_URL = f.status.API_URL.replace("54321", "55321"); }, "status/config port mismatch"],
  ["nonlocal API", f => { f.status.API_URL = "http://example.test:54321"; }, "nonlocal API"],
  ["wrong API protocol", f => { f.status.API_URL = "https://127.0.0.1:54321"; }, "nonlocal API"],
  ["nonlocal DB", f => { f.status.DB_URL = "postgresql://example.test:54322/postgres"; }, "nonlocal database"],
  ["wrong database", f => { const url = new URL(f.status.DB_URL); url.pathname = "/other"; f.status.DB_URL = url.toString(); }, "nonlocal database"],
  ["wrong selected container", f => { f.container = "supabase_db_other"; }, "database project name mismatch"],
];
for (const kind of ["database", "gateway"] as const) {
  faults.push(
    [`${kind} wrong name`, f => { f[kind].Name = "/supabase_db_other"; }, `${kind} project name mismatch`],
    [`${kind} wrong project label`, f => { f[kind].Config!.Labels!["com.supabase.cli.project"] = "other"; }, `${kind} project label mismatch`],
    [`${kind} missing supported labels`, f => { f[kind].Config!.Labels = {}; }, `${kind} project label mismatch`],
    [`${kind} wrong compose label`, f => { f[kind].Config!.Labels!["com.docker.compose.project"] = "other"; }, `${kind} project label mismatch`],
    [`${kind} wrong workdir label`, f => { f[kind].Config!.Labels!["com.supabase.cli.workdir"] = "/other/openplan"; }, `${kind} workdir label mismatch`],
    [`${kind} stopped`, f => { f[kind].State!.Running = false; }, `${kind} is not running`],
    [`${kind} missing running evidence`, f => { delete f[kind].State; }, `${kind} is not running`],
    [`${kind} wrong published port`, f => { f[kind].NetworkSettings!.Ports = { "5432/tcp": [{ HostPort: "59999" }], "8000/tcp": [{ HostPort: "59999" }] }; }, `${kind} published port mismatch`],
    [`${kind} missing port evidence`, f => { f[kind].NetworkSettings!.Ports = {}; }, `${kind} published port mismatch`],
    [`${kind} missing project network`, f => { f[kind].NetworkSettings!.Networks = {}; }, `${kind} project network missing`],
  );
}
faults.push(["different network IDs", f => { f.gateway.NetworkSettings!.Networks!.supabase_network_openplan.NetworkID = "other-id"; }, "database/gateway network mismatch"]);

describe("chat HTTP target binding before SQL", () => {
  it.each([false, true])("admits supported project evidence with workdir label %s", labeled => {
    expect(() => assertChatHttpTargetBinding(evidence(labeled))).not.toThrow();
  });
  it("uses an explicit config project rather than the directory basename", () => {
    const f = evidence();
    f.workdir = "/isolated/different-directory";
    f.configPath = `${f.workdir}/supabase/config.toml`;
    f.configText = 'project_id = "openplan"\n' + f.configText;
    expect(() => assertChatHttpTargetBinding(f)).not.toThrow();
  });
  it.each(faults)("refuses %s", (_name, change, reason) => {
    const f = evidence(); change(f);
    expect(() => assertChatHttpTargetBinding(f)).toThrow(reason);
  });
  it("refuses malformed config rather than accepting absent evidence", () => {
    const f = evidence(); f.configText = "[api";
    expect(() => assertChatHttpTargetBinding(f)).toThrow();
  });
});

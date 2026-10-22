import { basename, isAbsolute, join } from "node:path";
import { parse } from "smol-toml";

type ContainerEvidence = {
  Name?: string;
  Config?: { Labels?: Record<string, string> | null };
  State?: { Running?: boolean };
  NetworkSettings?: {
    Ports?: Record<string, { HostPort: string }[] | null>;
    Networks?: Record<string, { NetworkID?: string }>;
  };
};

export type ChatHttpTargetEvidence = {
  workdir: string;
  configPath: string;
  configText: string;
  status: { API_URL: string; DB_URL: string };
  container: string;
  database: ContainerEvidence;
  gateway: ContainerEvidence;
};

// Test-only admission before fixture SQL. CLI 2.111.0's Go path has project
// labels, not a workdir label. Its TS path also stamps workdir. Require the
// explicit config/status/project/port/network chain on either path.
export function assertChatHttpTargetBinding(input: ChatHttpTargetEvidence): void {
  const refuse = (reason: string): never => { throw new Error(`Chat HTTP target refused: ${reason}`); };
  if (!isAbsolute(input.workdir) || input.configPath !== join(input.workdir, "supabase/config.toml")) refuse("explicit workdir/config mismatch");
  const config = parse(input.configText);
  const projectValue = config.project_id ?? basename(input.workdir);
  if (typeof projectValue !== "string") refuse("invalid project identity");
  // Same sanitization as the pinned CLI's legacySanitizeProjectId/GetId.
  const project = (projectValue as string).replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^[_.-]+/, "").slice(0, 40);
  if (!project) refuse("missing project identity");
  const apiConfig = config.api, dbConfig = config.db;
  if (!apiConfig || typeof apiConfig !== "object" || Array.isArray(apiConfig)
    || !dbConfig || typeof dbConfig !== "object" || Array.isArray(dbConfig)) refuse("missing API/DB config");
  const apiPort = (apiConfig as Record<string, unknown>).port, dbPort = (dbConfig as Record<string, unknown>).port;
  if (![apiPort, dbPort].every(port => typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535)) refuse("missing API/DB ports");
  const api = new URL(input.status.API_URL), db = new URL(input.status.DB_URL);
  if (api.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(api.hostname) || api.pathname !== "/" || api.search || api.hash || api.username || api.password) refuse("nonlocal API");
  if (!["postgres:", "postgresql:"].includes(db.protocol) || !["127.0.0.1", "localhost"].includes(db.hostname) || db.pathname !== "/postgres" || db.search || db.hash) refuse("nonlocal database");
  if (api.port !== String(apiPort) || db.port !== String(dbPort)) refuse("status/config port mismatch");
  const network = `supabase_network_${project}`;
  const networkIds: string[] = [];
  for (const [kind, inspected, service, port, hostPort] of [
    ["database", input.database, "db", "5432/tcp", db.port],
    ["gateway", input.gateway, "kong", "8000/tcp", api.port],
  ] as const) {
    const name = `supabase_${service}_${project}`;
    if (inspected.Name !== `/${name}` || (kind === "database" && input.container !== name)) refuse(`${kind} project name mismatch`);
    const labels = inspected.Config?.Labels;
    if (labels?.["com.supabase.cli.project"] !== project || labels?.["com.docker.compose.project"] !== project) refuse(`${kind} project label mismatch`);
    const labeledWorkdir = labels?.["com.supabase.cli.workdir"];
    if (labeledWorkdir !== undefined && labeledWorkdir !== input.workdir) refuse(`${kind} workdir label mismatch`);
    if (inspected.State?.Running !== true) refuse(`${kind} is not running`);
    if (!inspected.NetworkSettings?.Ports?.[port]?.some(binding => binding.HostPort === hostPort)) refuse(`${kind} published port mismatch`);
    const id = inspected.NetworkSettings?.Networks?.[network]?.NetworkID;
    if (!id) refuse(`${kind} project network missing`);
    networkIds.push(id as string);
  }
  if (networkIds[0] !== networkIds[1]) refuse("database/gateway network mismatch");
}

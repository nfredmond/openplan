import { describe, expect, it, vi } from "vitest";
import {
  createOwnedWorkspace,
  DEFAULT_OWNED_WORKSPACE_LIMIT,
  ownedWorkspaceLimitMessage,
  resolveOwnedWorkspaceLimit,
} from "@/lib/workspaces/owned-workspace-limit";
import {
  checkWorkspaceStorageRoom,
  DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES,
  formatStorageBytes,
  readWorkspaceStorageUsage,
  resolveWorkspaceStorageQuotaBytes,
  WORKSPACE_STORAGE_UNREADABLE_MESSAGE,
  workspaceStorageFullMessage,
} from "@/lib/workspaces/storage-quota";

/**
 * The two operator-set limits for a deployment with public signup: how many
 * workspaces one person may own, and how many bytes one workspace may store.
 * The database functions behind them are proven against the real schema in
 * workspace-account-limits-rls.test.ts; these tests prove what the
 * application asks of them and how it reads the answers.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const GIB = 1024 ** 3;

function rpcReturning(result: { data: unknown; error: { message: string; code?: string } | null }) {
  return vi.fn(async () => result);
}

type RpcClient = Parameters<typeof readWorkspaceStorageUsage>[0];
const asClient = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as RpcClient;

describe("how many workspaces one person may own", () => {
  it("defaults to 5 and reads a positive whole number from OPENPLAN_MAX_OWNED_WORKSPACES", () => {
    expect(DEFAULT_OWNED_WORKSPACE_LIMIT).toBe(5);
    expect(resolveOwnedWorkspaceLimit({})).toBe(5);
    expect(resolveOwnedWorkspaceLimit({ OPENPLAN_MAX_OWNED_WORKSPACES: "20" })).toBe(20);
    expect(resolveOwnedWorkspaceLimit({ OPENPLAN_MAX_OWNED_WORKSPACES: " 1 " })).toBe(1);
  });

  it("keeps the default for a value that is not a positive whole number", () => {
    for (const value of ["0", "-1", "2.5", "1e3", "five", "", "99999999999999999999"]) {
      expect(resolveOwnedWorkspaceLimit({ OPENPLAN_MAX_OWNED_WORKSPACES: value }), value).toBe(5);
    }
  });

  it("asks create_owned_workspace for exactly this person, workspace and limit", async () => {
    const rpc = rpcReturning({
      data: {
        created: true,
        owned: 2,
        limit: 5,
        workspace: {
          id: WORKSPACE_ID,
          slug: "county-transportation-commission",
          stage_gate_template_id: "us_federal_aid_stage_gates_v0_1",
          stage_gate_template_version: "0.1.0",
          stage_gate_template_selection: "interim_unconfigured_default",
        },
      },
      error: null,
    });
    const result = await createOwnedWorkspace(asClient(rpc), {
      userId: USER_ID,
      name: "County Transportation Commission",
      slug: "county-transportation-commission",
      stageGateTemplateId: "us_federal_aid_stage_gates_v0_1",
      stageGateTemplateVersion: "0.1.0",
      stageGateTemplateSelection: "interim_unconfigured_default",
      stageGateBindingSource: "workspace_bootstrap_interim",
      limit: 5,
    });
    expect(rpc).toHaveBeenCalledWith("create_owned_workspace", {
      p_user_id: USER_ID,
      p_name: "County Transportation Commission",
      p_slug: "county-transportation-commission",
      p_stage_gate_template_id: "us_federal_aid_stage_gates_v0_1",
      p_stage_gate_template_version: "0.1.0",
      p_stage_gate_template_selection: "interim_unconfigured_default",
      p_stage_gate_binding_source: "workspace_bootstrap_interim",
      p_max_owned: 5,
    });
    expect(result).toMatchObject({ status: "created", workspace: { id: WORKSPACE_ID } });
  });

  it("reads a refusal, a database error and an unrecognized reply as three different outcomes", async () => {
    const input = {
      userId: USER_ID, name: "n", slug: "n", stageGateTemplateId: "t", stageGateTemplateVersion: "v",
      stageGateTemplateSelection: "s", stageGateBindingSource: "b", limit: 5,
    };
    expect(await createOwnedWorkspace(asClient(rpcReturning({ data: { created: false, owned: 5, limit: 5 }, error: null })), input))
      .toEqual({ status: "limit_reached", owned: 5, limit: 5 });
    expect(await createOwnedWorkspace(asClient(rpcReturning({ data: null, error: { message: "duplicate key", code: "23505" } })), input))
      .toEqual({ status: "error", error: { code: "23505", message: "duplicate key" } });
    expect((await createOwnedWorkspace(asClient(rpcReturning({ data: { created: true, owned: 1, limit: 5 }, error: null })), input)).status)
      .toBe("error");
  });

  it("names the operator and sells nothing", () => {
    const message = ownedWorkspaceLimitMessage(5);
    expect(message).toBe("You already own 5 workspaces, the most this OpenPlan site allows. Ask whoever runs this site to raise the limit.");
    expect(message).not.toMatch(/\b(upgrade|plan|tier|pay|paid|subscription)\b/i);
  });
});

describe("how many bytes one workspace may store", () => {
  it("defaults to 5 GiB and reads a positive whole number of bytes from OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", () => {
    expect(DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES).toBe(5 * GIB);
    expect(resolveWorkspaceStorageQuotaBytes({})).toBe(5 * GIB);
    expect(resolveWorkspaceStorageQuotaBytes({ OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES: String(20 * GIB) })).toBe(20 * GIB);
    for (const value of ["0", "-5", "1.5", "5GB", "", "99999999999999999999"]) {
      expect(resolveWorkspaceStorageQuotaBytes({ OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES: value }), value).toBe(5 * GIB);
    }
  });

  it("asks workspace_storage_bytes for exactly this workspace", async () => {
    const rpc = rpcReturning({ data: 1234, error: null });
    expect(await readWorkspaceStorageUsage(asClient(rpc), WORKSPACE_ID, {}))
      .toEqual({ status: "read", usedBytes: 1234, quotaBytes: 5 * GIB });
    expect(rpc).toHaveBeenCalledWith("workspace_storage_bytes", { p_workspace_id: WORKSPACE_ID });
  });

  it("reads a bigint sent as a numeric string", async () => {
    expect(await readWorkspaceStorageUsage(asClient(rpcReturning({ data: "5368709120", error: null })), WORKSPACE_ID, {}))
      .toMatchObject({ status: "read", usedBytes: 5 * GIB });
  });

  it("treats an error, a strange reply and a thrown call as unreadable, never as zero", async () => {
    const replies = [
      { data: null, error: { message: "permission denied" } },
      { data: null, error: null },
      { data: -1, error: null },
      { data: "lots", error: null },
      { data: { bytes: 0 }, error: null },
    ];
    for (const reply of replies) {
      expect((await readWorkspaceStorageUsage(asClient(rpcReturning(reply)), WORKSPACE_ID, {})).status, JSON.stringify(reply))
        .toBe("unreadable");
    }
    const throwing = vi.fn(async () => { throw new Error("fetch failed"); });
    expect(await readWorkspaceStorageUsage(asClient(throwing), WORKSPACE_ID, {}))
      .toMatchObject({ status: "unreadable", message: "fetch failed" });
  });

  it("lets a file fill the limit exactly and refuses one byte more", async () => {
    const env = { OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES: "1000" };
    const used = asClient(rpcReturning({ data: 900, error: null }));
    expect((await checkWorkspaceStorageRoom(used, WORKSPACE_ID, 100, env)).status).toBe("room");
    const over = await checkWorkspaceStorageRoom(used, WORKSPACE_ID, 101, env);
    expect(over).toEqual({
      status: "full",
      usedBytes: 900,
      quotaBytes: 1000,
      message: "This file would put the workspace over its 1000 bytes storage limit (900 bytes used). Delete files you no longer need, or ask whoever runs this OpenPlan site to raise the limit.",
    });
  });

  it("with an unknown size (0), refuses only a workspace already at its limit", async () => {
    const env = { OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES: "1000" };
    expect((await checkWorkspaceStorageRoom(asClient(rpcReturning({ data: 999, error: null })), WORKSPACE_ID, 0, env)).status).toBe("room");
    const atLimit = await checkWorkspaceStorageRoom(asClient(rpcReturning({ data: 1000, error: null })), WORKSPACE_ID, 0, env);
    expect(atLimit).toMatchObject({ status: "full", message: expect.stringMatching(/^This workspace has reached its 1000 bytes storage limit/) });
  });

  it("refuses with a plain message when use cannot be read, and keeps the database text out of it", async () => {
    const room = await checkWorkspaceStorageRoom(asClient(rpcReturning({ data: null, error: { message: "permission denied for function" } })), WORKSPACE_ID, 1, {});
    expect(room).toEqual({ status: "unreadable", message: WORKSPACE_STORAGE_UNREADABLE_MESSAGE, detail: "permission denied for function" });
    expect(WORKSPACE_STORAGE_UNREADABLE_MESSAGE).toBe("Storage use could not be checked, so nothing was uploaded. Try again in a minute.");
  });

  it("writes sizes in the binary units the per-file refusals use, and sells nothing", () => {
    expect(formatStorageBytes(5 * GIB)).toBe("5 GiB");
    expect(formatStorageBytes(4.94 * GIB)).toBe("4.9 GiB");
    expect(formatStorageBytes(100 * 1024 ** 2)).toBe("100 MiB");
    expect(formatStorageBytes(512)).toBe("512 bytes");
    const message = workspaceStorageFullMessage(4.9 * GIB, 5 * GIB, GIB);
    expect(message).toMatch(/whoever runs this OpenPlan site/);
    expect(message).not.toMatch(/\b(upgrade|plan|tier|pay|paid|subscription)\b/i);
  });
});

// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  readOriginalDispatch, recordOriginalDispatch, resolveDispatchCustodyScope,
  type OriginalApplicationJob,
} from "@/lib/aerial/original-dispatch";

const scope = { installationId: "installation-local-1", targetId: "database-local-1" };
const job: OriginalApplicationJob = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  request_id: "request-original-1", workspace_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  project_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", mission_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  created_by: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", preset_id: "balanced", imagery_type: "zip_url",
};

function wire(original = job) {
  return JSON.stringify({
    schemaVersion: "natford-aerial-processing.v1", requestId: original.request_id,
    callbackUrl: "https://app.example.test/api/aerial/callback?private=callback",
    externalRef: { system: "openplan", workspaceId: original.workspace_id, missionId: original.mission_id,
      ...(original.project_id === null ? {} : { projectId: original.project_id }) },
    missionTitle: "Aerial study près du métro", presetId: original.preset_id,
    imagery: { type: "zip_url", url: "https://source.example.test/photos.zip?private=source" },
  }, null, 2) + "\n";
}

function receipt(text = wire(), original = job) {
  return { format: "openplan.odm-application-dispatch.v1", ...scope, applicationJob: original,
    payloadText: text, payloadBytes: Buffer.byteLength(text, "utf8"),
    payloadSha256: createHash("sha256").update(text).digest("hex"), engineTransportPermission: false };
}

function client(data: unknown, error: unknown = null) {
  const abortSignal = vi.fn((_signal: AbortSignal) => Promise.resolve({ data, error }));
  const rpc = vi.fn((_name: string, _parameters: Record<string, string>) => ({ abortSignal }));
  return { rpc, abortSignal };
}

describe("original application aerial dispatch custody", () => {
  it("defaults to disabled and requires both stable identities only when enabled", () => {
    expect(resolveDispatchCustodyScope({})).toBeNull();
    expect(resolveDispatchCustodyScope({ OPENPLAN_AERIAL_DISPATCH_CUSTODY: "0" })).toBeNull();
    expect(resolveDispatchCustodyScope({ OPENPLAN_AERIAL_DISPATCH_CUSTODY: " 1 ",
      OPENPLAN_AERIAL_DISPATCH_INSTALLATION_ID: " installation-local-1 ",
      OPENPLAN_AERIAL_DISPATCH_TARGET_ID: " database-local-1 " })).toEqual(scope);
    for (const invalid of ["yes", "2"]) {
      expect(() => resolveDispatchCustodyScope({ OPENPLAN_AERIAL_DISPATCH_CUSTODY: invalid,
        OPENPLAN_AERIAL_DISPATCH_INSTALLATION_ID: scope.installationId,
        OPENPLAN_AERIAL_DISPATCH_TARGET_ID: scope.targetId })).toThrow("setting is invalid");
    }
    for (const missing of ["OPENPLAN_AERIAL_DISPATCH_INSTALLATION_ID", "OPENPLAN_AERIAL_DISPATCH_TARGET_ID"]) {
      const config: Record<string, string> = { OPENPLAN_AERIAL_DISPATCH_CUSTODY: "1",
        OPENPLAN_AERIAL_DISPATCH_INSTALLATION_ID: scope.installationId,
        OPENPLAN_AERIAL_DISPATCH_TARGET_ID: scope.targetId };
      delete config[missing];
      expect(() => resolveDispatchCustodyScope(config)).toThrow("identities are required");
    }
  });

  it("records exact UTF-8 text, actor, installation and target through a bounded service RPC", async () => {
    const text = wire(); const db = client(receipt(text));
    const saved = await recordOriginalDispatch(db, scope, job, text);
    expect(saved).toEqual(receipt(text));
    expect(saved.payloadBytes).toBeGreaterThan(text.length);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("record_aerial_original_dispatch", {
      p_job: job.id, p_actor: job.created_by, p_installation: scope.installationId,
      p_target: scope.targetId, p_payload_text: text,
    });
    expect(db.abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
  });

  it("preserves an explicitly nullable project", async () => {
    const original = { ...job, project_id: null }; const text = wire(original);
    const saved = await recordOriginalDispatch(client(receipt(text, original)), scope, original, text);
    expect(saved.applicationJob.project_id).toBeNull();
    expect(JSON.parse(saved.payloadText).externalRef).not.toHaveProperty("projectId");
  });

  it("preserves a complete v1.1 photo manifest with original private URLs", async () => {
    const original: OriginalApplicationJob = { ...job, imagery_type: "photo_manifest" };
    const payload = { ...JSON.parse(wire()), schemaVersion: "natford-aerial-processing.v1.1",
      imagery: { type: "photo_manifest", imageCount: 1, photos: [{ filename: "original.jpg",
        url: "https://source.example.test/original.jpg?private=signed", sizeBytes: 12, checksumSha256: "a".repeat(64) }] } };
    const text = JSON.stringify(payload, null, 2) + "\n";
    const saved = await recordOriginalDispatch(client(receipt(text, original)), scope, original, text);
    expect(saved.payloadText).toBe(text); expect(saved.applicationJob.imagery_type).toBe("photo_manifest");
  });

  it("refuses a valid manifest under an original ZIP job before storage", async () => {
    const payload = { ...JSON.parse(wire()), schemaVersion: "natford-aerial-processing.v1.1",
      imagery: { type: "photo_manifest", imageCount: 1, photos: [{ filename: "original.jpg", url: "https://source.example.test/original.jpg" }] } };
    const db = client(null);
    await expect(recordOriginalDispatch(db, scope, job, JSON.stringify(payload))).rejects.toThrow("job scope differs");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("refuses unbounded text before parsing or calling the database", async () => {
    const db = client(null);
    const text = wire().replace("source.example.test/photos.zip", "source.example.test/" + "x".repeat(32 * 1024 * 1024));
    let refusal: unknown;
    try { await recordOriginalDispatch(db, scope, job, text); } catch (error) { refusal = error; }
    expect(db.rpc).not.toHaveBeenCalled();
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toBe("Original aerial dispatch byte limit differs");
  });

  it("refuses malformed and wrong-version contracts before storage", async () => {
    for (const text of ["invalid", wire().replace("natford-aerial-processing.v1", "natford-aerial-processing.v1.1")]) {
      const db = client(null);
      await expect(recordOriginalDispatch(db, scope, job, text)).rejects.toThrow("contract differs");
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });

  it.each(["requestId", "system", "workspaceId", "missionId", "projectId", "presetId"])(
    "refuses a changed payload %s before storage", async (field) => {
      const payload = JSON.parse(wire());
      if (["system", "workspaceId", "missionId", "projectId"].includes(field)) payload.externalRef[field] = "changed-original-scope";
      else payload[field] = field === "presetId" ? "high-quality" : "changed-request";
      const db = client(null);
      await expect(recordOriginalDispatch(db, scope, job, JSON.stringify(payload))).rejects.toThrow("job scope differs");
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(job) as (keyof OriginalApplicationJob)[])("refuses changed receipt job field %s", async (field) => {
    const changed = { ...job, [field]: field === "preset_id" ? "high-quality"
      : field === "imagery_type" ? "photo_manifest" : field === "request_id" ? "different-request"
        : "ffffffff-ffff-4fff-8fff-ffffffffffff" };
    await expect(recordOriginalDispatch(client(receipt(wire(), changed as OriginalApplicationJob)), scope, job, wire()))
      .rejects.toThrow("receipt scope differs");
  });

  it.each(["installationId", "targetId"])("refuses changed receipt %s", async (field) => {
    await expect(recordOriginalDispatch(client({ ...receipt(), [field]: "other-installation" }), scope, job, wire()))
      .rejects.toThrow("receipt scope differs");
  });

  it.each(["payloadText", "payloadBytes", "payloadSha256"])("refuses changed receipt %s", async (field) => {
    const changed = { ...receipt(), [field]: field === "payloadText" ? wire().trim()
      : field === "payloadBytes" ? 1 : "0".repeat(64) };
    await expect(recordOriginalDispatch(client(changed), scope, job, wire())).rejects.toThrow("receipt bytes differ");
  });

  it("refuses absent, oversized, unknown-field and purported permission receipts", async () => {
    for (const data of [null, { ...receipt(), payloadBytes: 32 * 1024 * 1024 + 1 },
      { ...receipt(), extra: "unknown" }, { ...receipt(), engineTransportPermission: true }]) {
      await expect(recordOriginalDispatch(client(data), scope, job, wire())).rejects.toThrow("receipt differs");
    }
  });

  it.each([recordOriginalDispatch, readOriginalDispatch])("keeps provider diagnostics and source URLs out of its refusal through %s", async (operation) => {
    const db = client(null, { message: "secret source URL" });
    await expect(operation(db, scope, job, wire())).rejects.toThrow(/^Original aerial dispatch custody is unavailable$/);
  });

  it.each([recordOriginalDispatch, readOriginalDispatch])("keeps thrown transport diagnostics private through %s", async (operation) => {
    for (const stage of ["rpc", "abortSignal"]) {
      const db = client(null);
      const fail = () => { throw new Error("private transport URL"); };
      if (stage === "rpc") db.rpc.mockImplementation(fail);
      else db.abortSignal.mockImplementation(fail);
      await expect(operation(db, scope, job, wire())).rejects.toThrow(/^Original aerial dispatch custody is unavailable$/);
    }
  });

  it.each([true, false])("returns current scope observation %s without granting engine transport", async (authorizedNow) => {
    const data = { ...receipt(), authorizedNow, authorityObservedAt: "2026-10-12T03:30:00Z" };
    const db = client(data); const observed = await readOriginalDispatch(db, scope, job, wire());
    expect(observed).toEqual(data); expect(observed.engineTransportPermission).toBe(false);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("read_aerial_original_dispatch", {
      p_request: job.request_id, p_installation: scope.installationId, p_target: scope.targetId,
    });
    expect(db.abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
  });

  it("requires a typed current observation and the unchanged original bytes", async () => {
    for (const data of [receipt(), { ...receipt(), authorizedNow: "true", authorityObservedAt: "2026-10-12T03:30:00Z" },
      { ...receipt(), authorizedNow: true, authorityObservedAt: "unassessed" }]) {
      await expect(readOriginalDispatch(client(data), scope, job, wire())).rejects.toThrow("observation differs");
    }
    await expect(readOriginalDispatch(client({ ...receipt(), payloadText: wire().trim(),
      authorizedNow: true, authorityObservedAt: "2026-10-12T03:30:00Z" }), scope, job, wire())).rejects.toThrow("receipt bytes differ");
  });
});

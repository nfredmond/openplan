// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requests: Request[] = [];
const storage = createClient("https://storage.example.test", "synthetic-not-a-secret", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
  const request = new Request(input, init);
  requests.push(request);
  if (request.method === "POST") {
    return new Response(JSON.stringify({ signedURL: "/object/sign/synthetic?token=synthetic" }), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("synthetic artifact");
  } },
}).storage;

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ storage }) }));

import { loadArtifactBytes, storageRefAllowed } from "@/lib/models/artifact-source";
import { resolveTenantScopedStorageTarget } from "@/lib/files/tenant-scoped-storage";

const scope = { bucket: "run-artifacts", objectPathPrefix: "model-runs/synthetic-run/" };
const ordinaryNames = ["volumes.geojson", "exports/Plan 2026.pdf", "café (final).pdf", "revision..2.csv"];
const noncanonicalNames = [
  "../other/file.json", "%2e%2e/other/file.json", "%2E%2E/other/file.json",
  ".%2e/other/file.json", "%252e%252e/other/file.json", "%2fother/file.json",
  "%5cother/file.json", "..\\other\\file.json", "file.json?download=other",
  "file.json#other", "./file.json", "nested//file.json", "file.json/",
  "file\t.json", "file\n.json", "file\r.json", "file\u0000.json", "file\u007f.json",
  " file.json", "file.json ",
];

beforeEach(() => { requests.length = 0; });

describe("canonical Storage references", () => {
  it.each(ordinaryNames)("keeps the effective download and signing target for %s", async (name) => {
    const objectPath = scope.objectPathPrefix + name;
    const reference = `storage://${scope.bucket}/${objectPath}`;
    const target = resolveTenantScopedStorageTarget(reference, scope);
    expect(target).toEqual({ bucket: scope.bucket, objectPath });
    expect(new TextDecoder().decode(await loadArtifactBytes(reference, scope))).toBe("synthetic artifact");
    const signed = await storage.from(target!.bucket).createSignedUrl(target!.objectPath, 60);
    expect(signed.error).toBeNull();
    expect(requests.map((request) => decodeURIComponent(new URL(request.url).pathname))).toEqual([
      `/storage/v1/object/${scope.bucket}/${objectPath}`,
      `/storage/v1/object/sign/${scope.bucket}/${objectPath}`,
    ]);
  });

  it.each(noncanonicalNames)("refuses %j before a privileged request", async (name) => {
    const reference = `storage://${scope.bucket}/${scope.objectPathPrefix}${name}`;
    expect(resolveTenantScopedStorageTarget(reference, scope)).toBeNull();
    await expect(loadArtifactBytes(reference, scope)).rejects.toThrow("outside this run's scope");
    expect(requests).toEqual([]);
  });

  it("requires an exact bucket and complete parent prefix", () => {
    const objectPath = scope.objectPathPrefix + "file.json";
    expect(storageRefAllowed({ bucket: "other-bucket", objectPath }, scope)).toBe(false);
    expect(storageRefAllowed({ bucket: scope.bucket, objectPath: "model-runs/synthetic-run-other/file.json" }, scope)).toBe(false);
    expect(storageRefAllowed({ bucket: scope.bucket, objectPath }, { ...scope, objectPathPrefix: "model-runs/synthetic-run" })).toBe(false);
    expect(storageRefAllowed({ bucket: scope.bucket, objectPath: scope.objectPathPrefix }, scope)).toBe(false);
  });
});

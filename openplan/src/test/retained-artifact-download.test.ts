import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAuthenticatedArtifact } from "@/lib/export/download";

const bytes = new TextEncoder().encode("Synthetic retained review file");
const checksum = createHash("sha256").update(bytes).digest("hex");
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function harness(body: Uint8Array = bytes, status = 200) {
  vi.useFakeTimers(); vi.stubGlobal("crypto", webcrypto);
  const request = vi.fn().mockResolvedValue(new Response(new Uint8Array(body).buffer, { status, headers: { "Content-Type": "application/pdf" } }));
  vi.stubGlobal("fetch", request);
  const create = vi.fn().mockReturnValue("blob:test-artifact");
  vi.spyOn(URL, "createObjectURL").mockImplementation(create);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { request, create, revoke, click };
}
describe("retained artifact browser delivery", () => {
  it("requests private bytes and only starts download after checksum verification", async () => {
    const h = harness();
    await downloadAuthenticatedArtifact("/api/retained-file", "proposal.pdf", checksum);
    expect(h.request).toHaveBeenCalledWith(new URL("/api/retained-file", window.location.origin).href, { credentials: "same-origin", cache: "no-store" });
    expect(h.create).toHaveBeenCalledOnce(); expect(h.click).toHaveBeenCalledOnce();
    expect(h.revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000); expect(h.revoke).toHaveBeenCalledWith("blob:test-artifact");
  });
  it("withholds a corrupted successful response and keeps the download guard consequential", async () => {
    const h = harness(new TextEncoder().encode("Wrong revision"));
    await expect(downloadAuthenticatedArtifact("/api/retained-file", "proposal.pdf", checksum)).rejects.toThrow("differs");
    expect(h.click).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
  it("withholds revoked access and foreign URLs before creating a browser file", async () => {
    const h = harness(bytes, 403);
    await expect(downloadAuthenticatedArtifact("/api/retained-file", "proposal.pdf", checksum)).rejects.toThrow("Check access");
    await expect(downloadAuthenticatedArtifact("https://foreign.example/artifact", "proposal.pdf", checksum)).rejects.toThrow("identity");
    expect(h.request).toHaveBeenCalledOnce(); expect(h.click).not.toHaveBeenCalled();
  });
});

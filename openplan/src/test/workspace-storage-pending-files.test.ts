import { describe, expect, it, vi } from "vitest";
import { storageBytesNotYetStored } from "@/lib/workspaces/storage-quota";

// storageBytesNotYetStored charges a retried writer only for files not already
// at their paths (KI-2026-10-12-014). Each case varies one thing the lookup
// could get wrong.
type Entry = { name: string; id: string | null; metadata: { size?: unknown } | null };

function lister(byParent: Record<string, Entry[] | Error | { error: string }>) {
  const list = vi.fn(async (parent: string, options?: { search?: string }) => {
    const found = byParent[parent];
    if (found instanceof Error) throw found;
    if (found && !Array.isArray(found)) return { data: null, error: { message: found.error } };
    return { data: (found ?? []).filter((entry) => entry.name.startsWith(options?.search ?? "")), error: null };
  });
  const from = vi.fn(() => ({ list }));
  return { list, from, service: { storage: { from } } as unknown as Parameters<typeof storageBytesNotYetStored>[0] };
}

const file = (name: string, size: unknown): Entry => ({ name, id: `id-${name}`, metadata: { size } });

describe("storageBytesNotYetStored", () => {
  it("charges nothing for a file already at its path with the same recorded size", async () => {
    const { service, list, from } = lister({ "w/r/j": [file("a.pdf", 10)] });
    expect(await storageBytesNotYetStored(service, "report-artifacts", [{ path: "w/r/j/a.pdf", bytes: 10 }])).toBe(0);
    expect(from).toHaveBeenCalledWith("report-artifacts");
    expect(list).toHaveBeenCalledWith("w/r/j", { limit: 100, search: "a.pdf" });
  });

  it("charges only the missing files", async () => {
    const { service } = lister({ "w/r/j": [file("a.pdf", 10)] });
    expect(
      await storageBytesNotYetStored(service, "report-artifacts", [
        { path: "w/r/j/a.pdf", bytes: 10 },
        { path: "w/r/j/b.xlsx", bytes: 20 },
        { path: "w/r/j/c.zip", bytes: 30 },
      ])
    ).toBe(50);
  });

  it("charges a file whose stored size differs, or whose size is unrecorded", async () => {
    const { service } = lister({ "w/r/j": [file("a.pdf", 11), file("b.pdf", "10"), { name: "c.pdf", id: "c", metadata: null }] });
    expect(
      await storageBytesNotYetStored(service, "report-artifacts", [
        { path: "w/r/j/a.pdf", bytes: 10 },
        { path: "w/r/j/b.pdf", bytes: 10 },
        { path: "w/r/j/c.pdf", bytes: 10 },
      ])
    ).toBe(30);
  });

  it("requires the exact name, not a longer name the search also returns", async () => {
    const { service } = lister({ "w/r/j": [file("a.pdf.partial", 10)] });
    expect(await storageBytesNotYetStored(service, "report-artifacts", [{ path: "w/r/j/a.pdf", bytes: 10 }])).toBe(10);
  });

  it("looks in the file's own folder, not a sibling with the same name", async () => {
    const { service } = lister({ "w/r/other": [file("a.pdf", 10)] });
    expect(await storageBytesNotYetStored(service, "report-artifacts", [{ path: "w/r/j/a.pdf", bytes: 10 }])).toBe(10);
  });

  it("charges in full when the folder cannot be listed or the lookup throws", async () => {
    const failed = lister({ "w/r/j": { error: "list unavailable" } });
    expect(await storageBytesNotYetStored(failed.service, "report-artifacts", [{ path: "w/r/j/a.pdf", bytes: 10 }])).toBe(10);
    const thrown = lister({ "w/r/j": new Error("network") });
    expect(await storageBytesNotYetStored(thrown.service, "report-artifacts", [{ path: "w/r/j/a.pdf", bytes: 10 }])).toBe(10);
  });
});

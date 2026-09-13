import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslationDrafts } from "@/components/engagement/translation-draft-recovery";
import { translationDraftStorageKey } from "@/lib/engagement/translation-drafts";
import { translationEditorFixture, translationTestId as id, translationTestUser as userId, translationTestWorkspace as workspaceId } from "./helpers/translation-editor-fixture";

const scope = { userId, workspaceId, campaignId: id(1) };
const address = { entityType: "campaign" as const, entityId: id(1), field: "title" };
const key = translationDraftStorageKey(scope), words = "\u00a0SYNTHETIC latest words\ufeff", damaged = "\u00a0{SYNTHETIC damaged stored copy\ufeff";
function Editor() {
  const draft = useTranslationDrafts(scope);
  return <><input aria-label="Draft words" readOnly={!draft.ready} value={draft.find("es", `campaign:${id(1)}:title`)?.text ?? ""}
    onChange={event => draft.setText(translationEditorFixture(), address, "es", event.target.value)} />{draft.recovery}</>;
}
function type(text: string) { fireEvent.change(screen.getByLabelText("Draft words"), { target: { value: text } }); }
function archives() { return Object.keys(sessionStorage).filter(name => name.startsWith(key + ":archive:")).map(name => sessionStorage.getItem(name)); }
beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("unsaved translation storage recovery", () => {
  it("archives both the page draft and changed stored bytes before starting fresh", () => {
    render(<Editor />); type(words); const pageCopy = sessionStorage.getItem(key);
    sessionStorage.setItem(key, damaged);
    fireEvent.click(screen.getByText("Unsaved translation drafts"));
    fireEvent.click(screen.getByRole("button", { name: "Preserve these drafts and start fresh" }));
    expect(archives()).toEqual(expect.arrayContaining([pageCopy, damaged]));
    expect(sessionStorage.getItem(key)).toBeNull(); expect(screen.getByLabelText("Draft words")).toHaveValue("");
  });
  it("does not overwrite changed stored bytes while keeping the newest words on the page", () => {
    render(<Editor />); type(words); sessionStorage.setItem(key, damaged);
    type(words + " NEWER");
    expect(sessionStorage.getItem(key)).toBe(damaged); expect(screen.getByLabelText("Draft words")).toHaveValue(words + " NEWER");
  });
  it("keeps page words through a quota failure and retries the same draft when storage returns", () => {
    render(<Editor />); type(words); const stored = sessionStorage.getItem(key);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SYNTHETIC quota full"); });
    type(words + " NEWER"); expect(sessionStorage.getItem(key)).toBe(stored);
    expect(screen.getByText(/could not retain the latest draft/)).toBeVisible(); expect(screen.getByLabelText("Draft words")).toHaveValue(words + " NEWER");
    setItem.mockRestore(); fireEvent.click(screen.getByRole("button", { name: "Retry retaining latest draft" }));
    expect(JSON.parse(sessionStorage.getItem(key)!).entries[0].text).toBe(words + " NEWER");
    expect(screen.queryByText(/could not retain the latest draft/)).toBeNull();
  });
  it("does not replace page words by rereading a changed stored copy on a retention retry", () => {
    render(<Editor />); type(words); sessionStorage.setItem(key, damaged); type(words + " NEWER");
    fireEvent.click(screen.getByRole("button", { name: "Retry retaining latest draft" }));
    expect(sessionStorage.getItem(key)).toBe(damaged); expect(screen.getByLabelText("Draft words")).toHaveValue(words + " NEWER");
  });
  it("preserves unreadable bytes after a remount and opens a fresh editor only after archiving", () => {
    sessionStorage.setItem(key, damaged); render(<Editor />);
    expect(screen.getByLabelText("Draft words")).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "Retry unsaved draft recovery" }));
    expect(sessionStorage.getItem(key)).toBe(damaged); expect(screen.getByLabelText("Draft words")).toHaveAttribute("readonly");
    fireEvent.click(screen.getByText("Unsaved translation drafts"));
    fireEvent.click(screen.getByRole("button", { name: "Preserve these drafts and start fresh" }));
    expect(archives()).toEqual([damaged]); expect(screen.getByLabelText("Draft words")).not.toHaveAttribute("readonly");
  });
  it("keeps both page and stored words when a quota failure interrupts their archival", () => {
    render(<Editor />); type(words); sessionStorage.setItem(key, damaged); const put = Storage.prototype.setItem; let writes = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, name: string, value: string) {
      if (++writes === 2) throw new Error("SYNTHETIC archive quota full"); put.call(this, name, value);
    });
    fireEvent.click(screen.getByText("Unsaved translation drafts"));
    fireEvent.click(screen.getByRole("button", { name: "Preserve these drafts and start fresh" }));
    expect(screen.getByText(/draft copy could not be preserved/)).toBeVisible();
    expect(sessionStorage.getItem(key)).toBe(damaged); expect(screen.getByLabelText("Draft words")).toHaveValue(words);
  });

  it("downloads the newer page draft and the differing stored bytes as separate copies", async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { blobs.push(blob); return "blob:synthetic"; }, revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<Editor />); type(words); sessionStorage.setItem(key, damaged); type(words + " NEWER");
    fireEvent.click(screen.getByText("Unsaved translation drafts"));
    fireEvent.click(screen.getByRole("button", { name: "Download unsaved drafts" }));
    fireEvent.click(screen.getByRole("button", { name: "Download stored draft copy" }));
    expect(blobs).toHaveLength(2);
    const text = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
    expect(JSON.parse(await text(blobs[0])).entries[0].text).toBe(words + " NEWER"); expect(await text(blobs[1])).toBe(damaged);
  });
  it("does not invent an empty download when an unreadable stored copy disappears", () => {
    const create = vi.fn(); vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: () => {} });
    sessionStorage.setItem(key, damaged); render(<Editor />); sessionStorage.removeItem(key);
    fireEvent.click(screen.getByText("Unsaved translation drafts"));
    fireEvent.click(screen.getByRole("button", { name: "Download unsaved drafts" }));
    expect(create).not.toHaveBeenCalled(); expect(screen.getByText(/draft could not be downloaded/)).toBeVisible();
  });

});

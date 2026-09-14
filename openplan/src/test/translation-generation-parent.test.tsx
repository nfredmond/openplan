import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CampaignTranslationsPanel } from "@/components/engagement/campaign-translations-panel";
import { campaignTranslationStateFromSnapshot } from "@/lib/engagement/campaign-translations";
import { pendingTranslationWords, readPendingTranslations } from "@/lib/engagement/pending-translation";
import type { TranslationGenerationRequest, TranslationGenerationRead } from "@/lib/engagement/translation-generation-request";
import { confirmDestructiveAction } from "./helpers/confirm-dialog";
import { translationEditorFixture, translationTestId as id, translationTestUser as userId, translationTestWorkspace as workspaceId } from "./helpers/translation-editor-fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

it("queues reviewed source then publishes selected retained output separately while preserving a manual draft", async () => {
  const snapshot = translationEditorFixture(), campaignId = snapshot.campaignId;
  const api = `/api/engagement/campaigns/${campaignId}/translations`;
  let generation: TranslationGenerationRequest | undefined, viewed: TranslationGenerationRead | undefined;
  const { revision, ...before } = snapshot.translations[0];
  const history = [{ id: id(88), campaign_id: campaignId, translation_id: before.id, revision, actor_id: userId, recorded_at: "2026-09-13T00:00:00Z",
    event: "legacy_baseline", record_sha256: "d".repeat(64), write_request_id: null, change: null, record: { ...before, created_at: "2026-09-13T00:00:00Z" } }];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url = String(input);
    if (url === api + "/generation" && options?.method === "POST") {
      generation = JSON.parse(String(options.body)) as TranslationGenerationRequest;
      viewed = { campaignId, workspaceId, actorId: userId, requestId: generation.requestId, locale: generation.locale, createdAt: "2026-09-13T00:00:00Z",
        fields: generation.fields.map(field => ({ ...field, state: "completed", attemptId: id(77), failureCode: null,
          output: { status: "completed", text: " \u00a0SYNTHETIC generated words\ufeff ", model: "synthetic-model", sourceHash: "a".repeat(64), outputHash: "b".repeat(64), deliveryDigest: "c".repeat(64), acceptedState: "completed" } })) };
      return reply({ requestId: generation.requestId, created: true }, 202);
    }
    if (url === api + "/generation?requestId=" + generation?.requestId) return reply(viewed);
    if (url === api + "/history") return reply({ history });
    if (url === api + "/commands" && options?.method === "POST") return reply({ kind: "conflict" }, 409);
    throw new Error(`Unexpected request: ${options?.method ?? "GET"} ${url}`);
  });
  render(<CampaignTranslationsPanel {...campaignTranslationStateFromSnapshot(snapshot)} userId={userId} workspaceId={workspaceId} campaignId={campaignId}
    canWrite machineTranslationAvailable machineBatchMax={25} acceptBatchMax={200}/>);
  fireEvent.change(screen.getByLabelText(/^In .*Spanish/), { target: { value: "SYNTHETIC unsaved manual draft" } });
  fireEvent.change(screen.getByLabelText("Reason for changing saved wording"), { target: { value: "SYNTHETIC publication reason" } });
  expect(screen.queryByRole("button", { name: "Publish as machine translation" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Generate translation for review" }));
  await screen.findByLabelText("Retained machine output");
  expect(fetch.mock.calls).toHaveLength(2);
  expect(generation!.fields[0].address).toEqual({ entityType: "campaign", entityId: campaignId, field: "title",
    expectedSource: { available: true, text: snapshot.campaign.title, sourceLocale: null }, expectedTranslation: { id: before.id, revision } });
  expect(screen.getByLabelText(/^In .*Spanish/)).toHaveValue("SYNTHETIC unsaved manual draft");
  expect(screen.getByText(/SYNTHETIC generated words/).textContent).toBe(viewed!.fields[0].output!.text);
  fireEvent.click(screen.getByRole("button", { name: "Publish this retained output with a machine label" }));
  await confirmDestructiveAction("Publish as a machine translation");
  await waitFor(() => expect(fetch.mock.calls).toHaveLength(4));
  const publication = JSON.parse(String(fetch.mock.calls[3][1]?.body));
  expect(String(fetch.mock.calls[3][0])).toBe(api + "/commands");
  expect(publication).toMatchObject({ operation: "publish_generated", reason: "SYNTHETIC publication reason", locale: "es", entries: [{
    expectedTranslation: { id: before.id, revision }, generation: { requestId: generation!.requestId, fieldId: generation!.fields[0].id, attemptId: id(77), deliveryDigest: "c".repeat(64) } }] });
  expect(publication.entries[0]).not.toHaveProperty("text");
  await screen.findByRole("button", { name: "Review current saved translations" });
  const retained = readPendingTranslations(localStorage, userId, campaignId, workspaceId).pending;
  expect(retained).toHaveLength(1); expect(pendingTranslationWords(retained[0], 0)).toBe(viewed!.fields[0].output!.text);
  expect(screen.getByLabelText(/^In .*Spanish/)).toHaveValue("SYNTHETIC unsaved manual draft");
});

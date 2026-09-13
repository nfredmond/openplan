import { randomUUID } from "node:crypto";
import { prepareTranslationCredential } from "../../../openplan/src/lib/integrations/translation-credentials";
import { translationGenerationPacketCanonical } from "../../../openplan/src/lib/engagement/translation-generation";
import { readTranslationGenerationCatalog, type TranslationGenerationCursor } from "../../../openplan/src/lib/engagement/translation-generation-catalog";

async function main() {
if (process.argv.includes("--read")) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { fixture, pages } = JSON.parse(input) as { fixture: { campaignId: string; workspaceId: string; requests: Array<{ id: string; createdAt: string }> }; pages: unknown[] };
  let cursor: TranslationGenerationCursor | null = null;
  const pageSizes: number[] = [];
  const found: string[] = [];
  for (const raw of pages) {
    const page = readTranslationGenerationCatalog(raw, fixture, cursor);
    found.push(...page.requests.map(request => request.id));
    pageSizes.push(page.requests.length);
    cursor = page.next;
  }
  const expected = [...fixture.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(row => row.id);
  if (JSON.stringify(found) !== JSON.stringify(expected)) throw new Error("Catalog skipped, repeated or reordered retained requests");
  process.stdout.write(JSON.stringify({ count: found.length, pageSizes, cursor: readTranslationGenerationCatalog(pages[0], fixture).next }));
} else {
  // Synthetic credentials only. This fixture never invokes a model or worker.
  process.env.OPENPLAN_INTEGRATION_KEY_SECRET = "SYNTHETIC-CATALOG-SECRET-0123456789";
  const workspaceId = randomUUID(), campaignId = randomUUID(), actorId = randomUUID();
  const source = "SYNTHETIC catalog source";
  const requests = Array.from({ length: 23 }, (_, index) => {
    const id = randomUUID();
    const fields = ["title", "summary"].map(field => {
      const fieldId = randomUUID();
      return { id: fieldId, address: { entityType: "campaign", entityId: campaignId, field,
        expectedSource: { text: source, sourceLocale: null, available: true }, expectedTranslation: null },
        packetCanonical: translationGenerationPacketCanonical({ schemaVersion: 1, workspaceId, campaignId, fieldId, sourceText: source, targetLanguage: "es" }) };
    });
    return { id, fields, createdAt: `2026-09-13T12:00:00.12345${Math.floor(index / 8)}Z`,
      credential: prepareTranslationCredential({ workspaceId, requestId: id, credentialId: randomUUID(), modelId: "synthetic-catalog-model", source: "env", apiKey: "SYNTHETIC-CATALOG-KEY" }) };
  });
  process.stdout.write(JSON.stringify({ workspaceId, campaignId, actorId, source, member: randomUUID(), viewer: randomUUID(), outsider: randomUUID(), foreignCampaign: randomUUID(), foreignWorkspace: randomUUID(), foreignRequest: randomUUID(), requests }));
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });

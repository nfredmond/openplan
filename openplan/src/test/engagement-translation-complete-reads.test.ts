import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAMPAIGN_TRANSLATION_COLUMNS,
  loadCampaignTranslatableFields,
  loadCampaignTranslations,
} from "@/lib/engagement/campaign-translations";

type Row = Record<string, string | number | boolean | null>;
const campaign = { id: "11111111-1111-4111-8111-111111111111", title: "SYNTHETIC source" };

// Emulate a configured PostgREST cap, including successful short pages. Record
// projections and ordering so an untyped mock cannot hide an incomplete query.
function cappedClient(tables: Record<string, Row[]>, cap: number, failureFrom?: number) {
  const calls: Array<{ table: string; columns: string; orders: string[]; filters: Array<[string, unknown]>; from: number }> = [];
  const client = {
    rpc: async () => ({ data: { campaignId: campaign.id, publishedOnly: true, count: 0, entries: [] }, error: null }),
    from: (table: string) => {
      const call = { table, columns: "", orders: [] as string[], filters: [] as Array<[string, unknown]>, from: 0 };
      let to = cap - 1;
      const query = {
        select: (columns: string) => { call.columns = columns; return query; },
        eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
        order: (column: string) => { call.orders.push(column); return query; },
        range: (from: number, end: number) => { call.from = from; to = end; return query; },
        then: (resolve: (result: { data: Row[] | null; error: { message: string } | null }) => unknown) => {
          calls.push(call);
          if (failureFrom !== undefined && call.from >= failureFrom) {
            return Promise.resolve(resolve({ data: null, error: { message: "SYNTHETIC later-page outage" } }));
          }
          const rows = (tables[table] ?? []).filter(row => call.filters.every(([column, value]) => row[column] === value));
          return Promise.resolve(resolve({ data: rows.slice(call.from, Math.min(to + 1, call.from + cap)), error: null }));
        },
      };
      return query;
    },
  } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  return { client, calls };
}

const id = (index: number) => `synthetic-${String(index).padStart(5, "0")}`;
function fixture(count: number) {
  return {
    engagement_categories: Array.from({ length: count }, (_, i) => ({ id: id(i), campaign_id: campaign.id, label: `Topic ${i}` })),
    engagement_survey_questions: Array.from({ length: count }, (_, i) => ({ id: id(i), campaign_id: campaign.id, prompt: `Question ${i}`, is_active: true, status: "published" })),
    engagement_survey_question_options: Array.from({ length: count }, (_, i) => ({ id: id(i), campaign_id: campaign.id, question_id: id(0), label: `Option ${i}`, is_active: true })),
    engagement_content_translations: Array.from({ length: count }, (_, i) => ({ id: id(i), campaign_id: campaign.id, entity_type: "category", entity_id: id(i), field: "label", locale: "es", translated_text: `SYNTHETIC wording ${i}`, source: "operator", source_text_hash: "synthetic" })),
  };
}

describe("complete campaign translation reads", () => {
  it.each([{ count: 5, cap: 2 }, { count: 1005, cap: 1000 }])("loads every source and saved wording at count $count and cap $cap", async ({ count, cap }) => {
    const probe = cappedClient(fixture(count), cap);
    const inventory = await loadCampaignTranslatableFields(probe.client, campaign);
    const saved = await loadCampaignTranslations(probe.client, campaign.id);
    expect(inventory.readFailures).toEqual([]);
    expect(saved.failure).toBeNull();
    expect(inventory.fields.filter(field => field.entity === "category")).toHaveLength(count);
    expect(inventory.fields.filter(field => field.entity === "survey_question")).toHaveLength(count);
    expect(inventory.fields.filter(field => field.entity === "survey_question_option")).toHaveLength(count);
    expect(saved.rows).toHaveLength(count);
    expect(saved.rows.at(-1)?.translated_text).toBe(`SYNTHETIC wording ${count - 1}`);
    for (const call of probe.calls) {
      expect(call.filters).toContainEqual(["campaign_id", campaign.id]);
      expect(call.orders.at(-1), call.table).toBe("id");
      const projections: Record<string, string> = {
        engagement_categories: "id, label, description",
        engagement_survey_questions: "id, prompt, help_text",
        engagement_survey_question_options: "id, question_id, label",
        engagement_content_translations: CAMPAIGN_TRANSLATION_COLUMNS,
      };
      expect(call.columns).toBe(projections[call.table]);
    }
    for (const table of Object.keys(fixture(0))) {
      expect(probe.calls.some(call => call.table === table && call.from === count), `empty final page for ${table}`).toBe(true);
    }
  });

  it("discards earlier pages and reports a later-page outage", async () => {
    const probe = cappedClient(fixture(5), 2, 2);
    const inventory = await loadCampaignTranslatableFields(probe.client, campaign);
    const saved = await loadCampaignTranslations(probe.client, campaign.id);
    expect(inventory.readFailures).toHaveLength(3);
    expect(inventory.fields).toHaveLength(1);
    expect(saved.rows).toEqual([]);
    expect(saved.failure?.message).toContain("SYNTHETIC later-page outage");
  });

  it("withholds results when the page ceiling prevents proving exhaustion", async () => {
    const probe = cappedClient(fixture(201), 1);
    const inventory = await loadCampaignTranslatableFields(probe.client, campaign);
    const saved = await loadCampaignTranslations(probe.client, campaign.id);
    expect(inventory.readFailures).toHaveLength(3);
    expect(inventory.fields).toHaveLength(1);
    expect(saved.rows).toEqual([]);
    expect(saved.failure).not.toBeNull();
  });
});

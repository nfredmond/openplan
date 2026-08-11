import { describe, expect, it } from "vitest";
import { CAMPAIGN_TEMPLATES, getCampaignTemplate } from "@/lib/engagement/campaign-templates";
import { ENGAGEMENT_TYPES } from "@/lib/engagement/catalog";
import { SURVEY_QUESTION_TYPES, isSurveyQuestionType, validateSurveyConfig } from "@/lib/engagement/survey";

/**
 * The campaign-template registry is DATA that becomes real database rows the
 * moment a planner clicks Create — through the same validation the manual
 * builder uses, but with nobody reading each row on the way in. So the registry
 * itself is held to the invariants that matter:
 *
 * - every question speaks the survey module's own vocabulary and validates
 *   against its own config schema (a template that fails validation at apply
 *   time is a campaign created half-empty);
 * - the registry has NO WAY to say "published" — templates seed drafts, and the
 *   vocabulary for anything else must not exist in the data;
 * - nothing place-specific: no coordinates, no camera, no place names baked in.
 */

describe("campaign template registry", () => {
  it("has at least three templates with unique ids, and the lookup finds each", () => {
    expect(CAMPAIGN_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    const ids = CAMPAIGN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(getCampaignTemplate(id)?.id).toBe(id);
    }
    expect(getCampaignTemplate("no-such-template")).toBeNull();
  });

  it("uses only engagement types and question types the product actually has", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      expect(ENGAGEMENT_TYPES, template.id).toContain(template.engagementType);
      for (const question of template.questions) {
        expect(
          isSurveyQuestionType(question.questionType),
          `${template.id}: unknown question type ${question.questionType}`
        ).toBe(true);
      }
    }
  });

  it("every question's config passes the survey builder's own validation", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      for (const question of template.questions) {
        const result = validateSurveyConfig(question.questionType, question.config ?? {});
        expect(
          result.ok,
          `${template.id} / "${question.prompt}": ${result.ok ? "" : result.message}`
        ).toBe(true);
      }
    }
  });

  it("options exist exactly where the question type uses them", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      for (const question of template.questions) {
        const usesOptions = SURVEY_QUESTION_TYPES[question.questionType].usesOptions;
        const options = question.options ?? [];
        if (usesOptions) {
          // A choice question with fewer than two options is not a question.
          expect(options.length, `${template.id} / "${question.prompt}" needs options`).toBeGreaterThanOrEqual(2);
          const labels = options.map((o) => o.label);
          expect(new Set(labels).size, `${template.id} / "${question.prompt}" duplicate option labels`).toBe(
            labels.length
          );
        } else {
          expect(options.length, `${template.id} / "${question.prompt}" must not carry options`).toBe(0);
        }
      }
    }
  });

  it("cannot express publication: no status, publish, or is_active key anywhere in the data", () => {
    // Key-level, over the serialized registry, so a future field addition that
    // smuggles a publication vocabulary in under any template fails here even
    // if the apply path ignores it today.
    const forbiddenKeys = new Set(["status", "publish", "published", "is_active", "isActive"]);
    const seen: string[] = [];
    JSON.stringify(CAMPAIGN_TEMPLATES, (key, value) => {
      if (forbiddenKeys.has(key)) seen.push(key);
      return value;
    });
    expect(seen).toEqual([]);
  });

  it("carries nothing place-specific: no coordinates, cameras, or bounding boxes", () => {
    const forbiddenKeys = new Set(["center", "zoom", "latitude", "longitude", "lat", "lng", "lon", "bbox", "bounds"]);
    const seen: string[] = [];
    JSON.stringify(CAMPAIGN_TEMPLATES, (key, value) => {
      if (forbiddenKeys.has(key)) seen.push(key);
      return value;
    });
    expect(seen, "a template may not bake in a place — the campaign's own area frames its maps").toEqual([]);
  });

  it("conditions may not appear in template configs — they reference question ids that do not exist yet", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      for (const question of template.questions) {
        expect(
          (question.config ?? {})["visible_when"],
          `${template.id} / "${question.prompt}"`
        ).toBeUndefined();
      }
    }
  });

  it("carries the operator and resident texts every template needs", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      expect(template.label.trim().length, template.id).toBeGreaterThan(0);
      expect(template.description.trim().length, template.id).toBeGreaterThan(0);
      expect(template.suggestedSummary.trim().length, template.id).toBeGreaterThan(0);
      expect(template.suggestedPublicDescription.trim().length, template.id).toBeGreaterThan(0);
      // public_description is capped at 4000 by the campaign PATCH schema; the
      // create path must not write something the edit path would then refuse.
      expect(template.suggestedPublicDescription.length, template.id).toBeLessThanOrEqual(4000);
      expect(template.suggestedSummary.length, template.id).toBeLessThanOrEqual(2000);
      expect(template.categories.length, template.id).toBeGreaterThanOrEqual(2);
      expect(template.questions.length, template.id).toBeGreaterThanOrEqual(2);
      const categoryLabels = template.categories.map((c) => c.label);
      expect(new Set(categoryLabels).size, `${template.id} duplicate category labels`).toBe(categoryLabels.length);
    }
  });
});

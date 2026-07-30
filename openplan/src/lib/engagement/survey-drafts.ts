import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SURVEY_DRAFT_RETENTION_DAYS } from "./survey";

/**
 * SAVE AND RESUME FOR A SURVEY NOBODY IS SIGNED IN TO.
 *
 * THE PROBLEM THIS SOLVES. A campaign survey was answered in one sitting or not
 * at all. That falls hardest on the participants an agency is most often accused
 * of not hearing from: somebody answering on a phone, on a bus, in a language
 * they read slowly, on a form with twenty questions. "Come back later" was not
 * an option the product offered, so their answer was simply not collected.
 *
 * THE CREDENTIAL, and why it is shaped this way.
 *
 *  • It is a 256-BIT RANDOM TOKEN, not an id, not a sequence, not a fingerprint,
 *    not an email. A draft holds a resident's part-finished answers — which on
 *    these surveys include age band, primary language, housing tenure and where
 *    they live. A guessable resume handle would be a way to read a stranger's
 *    demographics, so the only acceptable design is one where guessing is not a
 *    strategy. 32 random bytes is that.
 *
 *  • THE SERVER NEVER STORES THE TOKEN — only its SHA-256. A stolen database
 *    backup therefore does not hand anybody a working key to every part-finished
 *    response, exactly as a password digest does not hand over passwords. The
 *    token is a high-entropy random value rather than a human-chosen secret, so
 *    a plain unsalted SHA-256 is right here: there is nothing to brute-force and
 *    a per-row salt would only prevent the constant-time indexed lookup this
 *    needs.
 *
 *  • THE TOKEN NEVER TRAVELS IN A URL. It is sent in a POST body and held in the
 *    browser's own storage. A resume LINK would leak the credential into browser
 *    history, into a `Referer` header on any outbound click, into a screenshot
 *    shared with a family member, and into whatever proxy logs the request line.
 *    Every one of those is a way for a resident's demographic answers to reach
 *    somebody they did not choose.
 *
 * WHAT THIS MEANS FOR THE PARTICIPANT, and it must be said to them plainly: a
 * draft is reachable from THAT BROWSER on THAT DEVICE, because that is where the
 * only copy of the credential is. Offering cross-device resume would mean
 * identifying the person — an email, an account, a code they type — and the
 * portal is deliberately anonymous. The honest product is the narrower one that
 * says what it does. The participant copy in `messages.ts` says exactly this.
 *
 * A DRAFT IS NOT A SUBMISSION. It is stored in its own table, and no aggregation,
 * moderation queue, representativeness reading or response count reads it. See
 * the migration for why that is a table boundary rather than a status column.
 */

/** Bytes of entropy in a resume token. 32 = 256 bits; do not lower this. */
const SURVEY_DRAFT_TOKEN_BYTES = 32;

/**
 * Live drafts one connection may hold on one campaign at a time.
 *
 * Bounds the only unauthenticated row-creating path this feature adds. It is a
 * soft, per-campaign cap for the same reason the one-response rule is a flag and
 * not a block: `buildPublicSubmissionClientFingerprint` is IP-only, so a library,
 * an office or a phone network shares one fingerprint between many real people.
 * Five is generous for one person and still bounds a script.
 */
export const SURVEY_DRAFT_MAX_LIVE_PER_FINGERPRINT = 5;

/** A base64url token as it is handed to the browser, and only then. */
export function mintSurveyDraftResumeToken(): string {
  return randomBytes(SURVEY_DRAFT_TOKEN_BYTES).toString("base64url");
}

/** The digest the database holds. The token itself is never written. */
export function hashSurveyDraftResumeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Compare two digests without leaking, through timing, how much of one matched.
 *
 * The lookup is an indexed equality on the hash, so this is belt-and-braces for
 * any caller that compares in application code. Length mismatch answers false
 * rather than throwing.
 */
export function surveyDraftTokenHashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** When a draft saved now stops being reachable. One constant, both sides. */
export function surveyDraftExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + SURVEY_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * A resume token as it arrives from a browser.
 *
 * Bounded and character-restricted before it reaches a query: this value is
 * attacker-controlled on a public route, and the only shape the server ever
 * issued is base64url.
 */
export const surveyDraftResumeTokenSchema = z
  .string()
  .trim()
  .min(24)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid resume token");

/**
 * One saved answer inside a draft.
 *
 * The answer is `unknown` here on purpose. A draft is a PART-FINISHED response,
 * so it legitimately holds answers that would fail `validateSurveyAnswer` — a
 * budget not yet fully allocated, a required question still blank, a ranking
 * with one item placed. Validating a draft against the submit rules would refuse
 * to save exactly the state a resident most needs saved. What IS enforced at
 * save time is that the question belongs to this campaign's active survey and
 * that the answer matches its type's STRUCTURAL shape — see the draft route.
 */
export const surveyDraftAnswerSchema = z
  .object({ questionId: z.string().uuid(), answer: z.unknown() })
  .strict();

export const surveyDraftAnswersSchema = z.array(surveyDraftAnswerSchema).max(300);

export type SurveyDraftAnswer = { questionId: string; answer: unknown };

/** The stored shape of `answers_json`. Versioned so a future change is readable. */
export type SurveyDraftPayload = { version: 1; answers: SurveyDraftAnswer[] };

export function buildSurveyDraftPayload(answers: SurveyDraftAnswer[]): SurveyDraftPayload {
  return { version: 1, answers };
}

/**
 * The campaign behind a share token, iff it is publicly open right now.
 *
 * Shared by the two draft routes rather than written twice: this is the check
 * that decides whether an anonymous request may touch a campaign at all, and two
 * copies of it is two chances for one to drift. It answers a STATUS rather than
 * a `NextResponse` so this module stays framework-free and testable without a
 * request object.
 */
export type OpenSurveyCampaignLookup =
  | { ok: true; campaign: { id: string; workspaceId: string } }
  | { ok: false; status: 403 | 404 | 500; error: string };

export async function loadOpenSurveyCampaign(
  supabase: Pick<SupabaseClient, "from">,
  shareToken: string
): Promise<OpenSurveyCampaignLookup> {
  const { data, error } = await supabase
    .from("engagement_campaigns")
    .select("id, workspace_id, allow_public_submissions, submissions_closed_at")
    .eq("share_token", shareToken)
    .eq("status", "active")
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "Failed to verify campaign" };

  const campaign = data as
    | {
        id: string;
        workspace_id: string;
        allow_public_submissions: boolean;
        submissions_closed_at: string | null;
      }
    | null;
  if (!campaign) return { ok: false, status: 404, error: "Campaign not found or not publicly available" };
  if (!campaign.allow_public_submissions || campaign.submissions_closed_at) {
    return { ok: false, status: 403, error: "This survey is not currently accepting responses" };
  }
  return { ok: true, campaign: { id: campaign.id, workspaceId: campaign.workspace_id } };
}

/**
 * Read a stored payload back, defensively.
 *
 * Returns [] for anything unreadable rather than throwing: the row is a public
 * participant's own work, and a resume that fails should present an empty form
 * with the truth said out loud, never a 500 on a phone.
 */
export function readSurveyDraftPayload(stored: unknown): SurveyDraftAnswer[] {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
  const answers = (stored as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return [];
  return answers.flatMap((entry) => {
    const parsed = surveyDraftAnswerSchema.safeParse(entry);
    return parsed.success ? [{ questionId: parsed.data.questionId, answer: parsed.data.answer }] : [];
  });
}

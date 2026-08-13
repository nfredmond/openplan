/**
 * SENDING A RESIDENT'S INPUT — the one implementation, shared by every form that
 * writes to `/api/engage/[shareToken]/submit`.
 *
 * There are now two of those forms: the classic stacked form on the context page
 * (`SubmissionForm` inside `public-engagement-portal.tsx`) and the guided
 * step-by-step rail beside the full-screen map (`public-map-sidebar.tsx`). They
 * look nothing alike on purpose. What they must never do is disagree about what
 * gets SENT — the two-step photo flow, the honeypot field, the shape of the
 * demographics object, whether an empty topic is omitted or sent as "".
 *
 * The failure this prevents is quiet. A second form that forgets `website` turns
 * the honeypot off for everyone who uses it; one that sends `zip5: ""` instead of
 * omitting it writes a blank where the analyst expects a null. Neither shows up
 * on any screen.
 *
 * NO COPY LIVES HERE. The function returns a discriminated result and the caller
 * words it, because the two callers are in the participant's language and this
 * module has no translator. `serverMessage` is the API's own English sentence
 * when it sent one — specific and useful, and marked as English by the caller.
 */

import type { EngagementGeometry } from "./geometry";

export type PortalSubmissionDemographics = {
  ageBand?: string;
  zip5?: string;
  primaryLanguage?: string;
  raceEthnicity?: string[];
  householdTenure?: string;
};

export type PortalSubmissionInput = {
  shareToken: string;
  /** The required free text. Everything else on this object is optional. */
  body: string;
  categoryId?: string;
  parentItemId?: string | null;
  title?: string;
  submittedBy?: string;
  geometry?: EngagementGeometry | null;
  photoFile?: File | null;
  /** The honeypot's current value — always sent, empty for a real person. */
  website: string;
  /**
   * Only when the campaign opted in. Absent (not empty) otherwise: a campaign
   * that never asked must not receive a `consented: true` for a question nobody
   * was shown.
   */
  demographics?: PortalSubmissionDemographics | null;
};

export type PortalSubmissionResult =
  | { ok: true }
  | { ok: false; stage: "photo" | "submit" | "network"; serverMessage: string | null };

/** Drop the empty strings a controlled input produces, so the API sees absent, not blank. */
function present(value: string | undefined | null): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Upload the photo (when there is one), then post the submission.
 *
 * The photo is a TWO-STEP flow because the submit route takes a storage path,
 * not bytes: upload first, reference the returned path second. A caller that
 * inlined this would be one refactor away from posting the file to the JSON
 * endpoint.
 *
 * Never throws for an HTTP failure — a rejected submission is an outcome a
 * resident has to be told about, not an exception, and the previous
 * throw/catch/instanceof shape made "the network dropped" and "the agency
 * refused this" arrive at the same place.
 */
export async function submitPortalInput(input: PortalSubmissionInput): Promise<PortalSubmissionResult> {
  try {
    let photoPath: string | undefined;

    if (input.photoFile) {
      const uploadResponse = await fetch(`/api/engage/${input.shareToken}/photo-upload`, {
        method: "POST",
        headers: { "content-type": input.photoFile.type },
        body: input.photoFile,
      });
      const uploadPayload = (await uploadResponse.json()) as { error?: string; photoPath?: string };
      if (!uploadResponse.ok || !uploadPayload.photoPath) {
        return { ok: false, stage: "photo", serverMessage: uploadPayload.error ?? null };
      }
      photoPath = uploadPayload.photoPath;
    }

    const demographics = input.demographics
      ? {
          ageBand: present(input.demographics.ageBand),
          // Five digits or nothing. A partial ZIP is a typo, and storing it
          // would put a wrong place in the equity read.
          zip5: /^\d{5}$/.test(input.demographics.zip5 ?? "") ? input.demographics.zip5 : undefined,
          primaryLanguage: present(input.demographics.primaryLanguage),
          raceEthnicity: input.demographics.raceEthnicity?.length
            ? input.demographics.raceEthnicity
            : undefined,
          householdTenure: present(input.demographics.householdTenure),
          consented: true,
        }
      : undefined;

    const response = await fetch(`/api/engage/${input.shareToken}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        categoryId: present(input.categoryId),
        parentItemId: input.parentItemId || undefined,
        title: present(input.title),
        body: input.body,
        submittedBy: present(input.submittedBy),
        geometry: input.geometry ?? undefined,
        photoPath,
        website: input.website,
        demographics,
      }),
    });

    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      return { ok: false, stage: "submit", serverMessage: payload.error ?? null };
    }

    return { ok: true };
  } catch {
    // A fetch that never completed, or a body that was not JSON. There is no
    // participant-facing wording from the server here, so the caller uses its
    // own translated generic rather than a stack message.
    return { ok: false, stage: "network", serverMessage: null };
  }
}

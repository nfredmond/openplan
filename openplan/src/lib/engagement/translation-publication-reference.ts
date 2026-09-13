import { z } from "zod";

const id = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const translationPublicationReferenceSchema = z.object({ requestId: id, fieldId: id, attemptId: id, deliveryDigest: digest }).strict();
export const translationPublicationEvidenceSchema = translationPublicationReferenceSchema.extend({ actorId: id, outputHash: digest }).strict();

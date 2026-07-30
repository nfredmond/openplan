/**
 * WHERE ONE INVITATION LIVES IN THE APP — and nothing else.
 *
 * This is a one-function module on purpose. `invitations.ts` hashes tokens, so
 * it imports `node:crypto`, and any CLIENT component that reaches for a path
 * from there drags the whole hashing module into the browser bundle — which
 * webpack refuses outright with "Reading from node:crypto is not handled by
 * plugins". The sign-in form is a client component and needs this path; the
 * server-side URL builder needs the same one. A shared constant that two
 * environments can both import is the only way they cannot drift.
 *
 * Same split, and the same reason, as `translation-languages.ts` beside the
 * engagement translation engine.
 */
export function invitationPath(token: string): string {
  return `/invitations/${encodeURIComponent(token)}`;
}

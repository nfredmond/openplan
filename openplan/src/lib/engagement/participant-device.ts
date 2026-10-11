/**
 * A random token naming one browser, so people sharing one connection (a
 * meeting room's Wi-Fi, a library, a campus) are not treated as one person.
 *
 * It identifies nobody: a random value kept in the browser's own storage, sent
 * with a comment or a vote, and stored only as a hash. The per-connection
 * limits still bound what one network can send, so a script minting new tokens
 * gains a room's allowance, not an unlimited one. With storage unavailable no
 * token is sent and the connection is treated as one device, as before.
 */

export const PARTICIPANT_DEVICE_HEADER = "x-openplan-device";
export const PARTICIPANT_DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_KEY = "openplan:participant-device";

/** This browser's token, created on first use; null when storage is unavailable. */
export function participantDeviceId(): string | null {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && PARTICIPANT_DEVICE_ID_PATTERN.test(existing)) return existing;
    const created = window.crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/** The header to send with a public comment, photo or vote. */
export function participantDeviceHeaders(): Record<string, string> {
  const id = participantDeviceId();
  return id ? { [PARTICIPANT_DEVICE_HEADER]: id } : {};
}

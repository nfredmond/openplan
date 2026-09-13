import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { finishResponseEmail, processResponseEmail } from "../../src/lib/notifications/engagement";
import { createResponseEmailJournal } from "../../src/lib/notifications/response-email-journal";

/** Local worker; outcome replay never calls the email transport a second time. */
async function main() {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!origin || new URL(origin).origin !== origin || !/^https?:/.test(origin)) {
    throw new Error("Set NEXT_PUBLIC_APP_URL to this installation's public origin, without a trailing slash.");
  }
  const client = createServiceRoleClient();
  const root = process.env.OPENPLAN_ENGAGEMENT_EMAIL_WORK_DIR || join(homedir(), ".local/state/openplan/engagement-email");
  const installation = createHash("sha256").update(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "").digest("hex").slice(0, 24);
  const directory = join(root, installation);
  const journal = await createResponseEmailJournal(directory);
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  while (!stopping) {
    // Interrupted database acknowledgements are retried from retained outcomes.
    // A malformed local file remains available for inspection and does not cause a send.
    const recovery = await journal.recover(outcome => finishResponseEmail(client, outcome));
    if (recovery.unreadable) console.error("A retained email outcome could not be read; no resend was attempted.");
    if (stopping) break;
    const result = await processResponseEmail(client, origin, journal);
    if (result === "unavailable") console.error("Email queue or outcome recording is unavailable; saved work remains retained.");
    if (result !== "progress") await delay(result === "idle" ? 2000 : 5000);
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Email worker could not start."); process.exitCode = 1; });

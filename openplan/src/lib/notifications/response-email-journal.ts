import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { responseEmailOutcomeSchema, type ResponseEmailOutcome } from "./response-email-outcome";

/** Preserve observed results locally until the same attempt is acknowledged by the database. */
export async function createResponseEmailJournal(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const basename = (outcome: ResponseEmailOutcome) => `${outcome.outboxId}-${outcome.attemptToken}`;
  const journal = {
    async retain(outcome: ResponseEmailOutcome) {
      const parsed = responseEmailOutcomeSchema.parse(outcome);
      const path = join(directory, `${basename(parsed)}.pending.json`);
      await writeFile(`${path}.partial`, JSON.stringify(parsed), { mode: 0o600 });
      await rename(`${path}.partial`, path);
    },
    async recorded(outcome: ResponseEmailOutcome) {
      const parsed = responseEmailOutcomeSchema.parse(outcome);
      await rename(join(directory, `${basename(parsed)}.pending.json`), join(directory, `${basename(parsed)}.recorded.json`));
    },
    async recover(finish: (outcome: ResponseEmailOutcome) => Promise<boolean>) {
      let unreadable = 0;
      let pending = 0;
      for (const name of (await readdir(directory)).filter(name => name.endsWith(".pending.json"))) {
        try {
          const outcome = responseEmailOutcomeSchema.parse(JSON.parse(await readFile(join(directory, name), "utf8")));
          if (name !== `${basename(outcome)}.pending.json`) throw new Error("Outcome filename mismatch");
          if (await finish(outcome)) await journal.recorded(outcome);
          else pending++;
        } catch { unreadable++; }
      }
      return { unreadable, pending };
    },
  };
  return journal;
}

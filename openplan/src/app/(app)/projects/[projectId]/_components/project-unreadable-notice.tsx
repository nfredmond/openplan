import Link from "next/link";
import { StateBlock } from "@/components/ui/state-block";

/**
 * What the project control room renders when the project row itself could not
 * be read.
 *
 * A 404 IS A CLAIM. The page used to answer `if (!projectData) notFound()`,
 * and `data` is null for both "no such project" and "that query failed" — so a
 * dropped column, a broken policy, or a database hiccup told a planner their
 * project did not exist. This is the other branch: the page shell, and an
 * error state that is careful NOT to say the project is missing.
 *
 * The database's own message is shown because this is an INTERNAL page and the
 * reader can act on it. The public surfaces deliberately do the opposite.
 */
export function ProjectUnreadableNotice({ message }: { message?: string | null }) {
  return (
    <section className="module-page">
      <div className="module-breadcrumb">
        <Link href="/projects" className="transition hover:text-foreground">
          Projects
        </Link>
      </div>
      <StateBlock
        tone="danger"
        title="This project could not be read"
        description={
          "The database refused the read for this project, so nothing below could be loaded. " +
          "This is not a statement that the project is missing — it may exist and be perfectly " +
          "intact. Reload, and if it keeps happening send an operator this message: " +
          (message?.trim() ? message.trim() : "no message reported")
        }
      />
    </section>
  );
}

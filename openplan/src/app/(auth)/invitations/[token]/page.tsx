import { redirect } from "next/navigation";
import { InvitationDecision } from "@/components/workspaces/invitation-decision";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  invitationPath,
  isInvitationExpired,
  loadInvitationByToken,
  normalizeInvitationEmail,
  WORKSPACE_ROLE_DESCRIPTIONS,
  type WorkspaceInvitationRow,
} from "@/lib/workspaces/invitations";

/**
 * THE PAGE WHERE SOMEONE DECIDES WHETHER TO JOIN A WORKSPACE.
 *
 * WHY IT EXISTS. Accepting used to be a side effect of signing in: the invite
 * link went to `/sign-up?invite=…`, the sign-in form POSTed the token to
 * `/api/workspaces/invitations/accept` on success, and the person landed inside
 * a workspace they had never been shown. They were told neither its name, nor
 * the role they had been granted, nor who invited them — and they could not
 * decline, because `/api/workspaces/invitations/decline` had been written,
 * tested and gated with nothing in the product calling it. An invitation with
 * no refusal is not an invitation.
 *
 * WHAT IS READ WITH THE SERVICE ROLE, AND WHY THAT IS SAFE. An invitee is by
 * definition not yet a member, so their RLS client cannot read the workspace
 * they are being invited to — not its name, not the invitation row. The lookup
 * therefore runs with the service role, and it is bounded three ways: the token
 * is matched by HASH (`loadInvitationByToken`), only a pending unexpired row
 * resolves, and NOTHING is shown until the signed-in user's email matches the
 * invited address. A stranger holding a leaked link learns nothing about the
 * workspace, because they cannot sign in as the invited person.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It performs no write. Reading an invitation
 * is not answering it, so a crawler, a link preview, or a mis-click cannot
 * enrol anybody. Both writes are POSTs from the buttons below.
 */

type PageProps = {
  params: Promise<{ token: string }>;
};

/**
 * The invited person's own email, resolved for display.
 *
 * A failed lookup yields null rather than failing the page: the identity that
 * MATTERS for the decision is the invitee's, which is already known, and an
 * inviter whose account was deleted must not make an otherwise valid invitation
 * unanswerable.
 */
async function inviterEmail(
  service: ReturnType<typeof createServiceRoleClient>,
  invitation: WorkspaceInvitationRow
): Promise<string | null> {
  if (!invitation.invited_by_user_id) return null;
  try {
    const lookup = await service.auth.admin.getUserById(invitation.invited_by_user_id);
    return lookup.data.user?.email ?? null;
  } catch {
    return null;
  }
}

function Refusal({ heading, detail }: { heading: string; detail: string }) {
  return (
    <section className="rounded-lg border border-border/70 bg-background/60 px-6 py-6">
      <h2 className="font-display text-2xl font-semibold tracking-tight">{heading}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Ask whoever invited you to send a new link — an invitation can be reissued from the workspace&apos;s
        team panel.
      </p>
    </section>
  );
}

export default async function InvitationPage({ params }: PageProps) {
  const { token } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in: send them to create or use the account the invitation names,
  // and come straight back here. The token rides in the redirect path, so the
  // sign-up → sign-in hop cannot drop it.
  if (!user) {
    const target = invitationPath(token);
    redirect(`/sign-up?invite=${encodeURIComponent(token)}&redirect=${encodeURIComponent(target)}`);
  }

  const service = createServiceRoleClient();

  let lookup;
  try {
    lookup = await loadInvitationByToken(service, token);
  } catch {
    // A read that FAILED is not an invitation that does not exist, and saying
    // "this link is not valid" about a database outage sends someone to ask for
    // a replacement link that will fail in exactly the same way.
    return (
      <Refusal
        heading="This invitation could not be loaded."
        detail="Something went wrong reading it — this is a problem on our side, not with your link. Try again in a moment."
      />
    );
  }

  if (!lookup.ok) {
    const expired =
      lookup.reason === "expired" ||
      (lookup.invitation ? isInvitationExpired(lookup.invitation) : false);
    return (
      <Refusal
        heading={expired ? "This invitation has expired." : "This invitation is no longer open."}
        detail={
          expired
            ? "Invitations are time-limited, and this one has passed its expiry."
            : "It may have already been accepted, declined, or withdrawn by the workspace."
        }
      />
    );
  }

  const invitation = lookup.invitation;

  // The signed-in account must be the invited one. Stated as a mismatch rather
  // than a refusal to look at, because the ordinary cause is a person signed in
  // on a personal account reading a work invitation — a fixable situation, not
  // an attack. Both addresses are named so they can see WHICH two disagree.
  const signedInEmail = normalizeInvitationEmail(user.email ?? "");
  if (!signedInEmail || signedInEmail !== invitation.email_normalized) {
    return (
      <Refusal
        heading="This invitation was sent to a different address."
        detail={`It was sent to ${invitation.email}, and you are signed in as ${user.email ?? "an account with no email"}. Sign in with the invited address to answer it.`}
      />
    );
  }

  const workspaceResult = await service
    .from("workspaces")
    .select("name")
    .eq("id", invitation.workspace_id)
    .maybeSingle();

  // A workspace whose name could not be read is still a workspace someone may
  // join; the decision does not depend on the label. `null` renders as a
  // neutral placeholder rather than an empty heading.
  const workspaceName =
    (workspaceResult.data as { name?: string | null } | null)?.name?.trim() || null;

  return (
    <InvitationDecision
      token={token}
      workspaceName={workspaceName}
      role={invitation.role}
      roleDescription={WORKSPACE_ROLE_DESCRIPTIONS[invitation.role]}
      invitedEmail={invitation.email}
      invitedBy={await inviterEmail(service, invitation)}
      expiresAt={invitation.expires_at}
    />
  );
}

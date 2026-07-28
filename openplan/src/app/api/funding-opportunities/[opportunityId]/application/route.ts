import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  APPLICATION_ATTACHMENT_SELECT,
  APPLICATION_PENDING_SCHEMA_ERROR,
  APPLICATION_SECTION_SELECT,
  buildCatalogAttachmentSeeds,
  buildCatalogSectionSeeds,
  findGrantProgramCatalogEntry,
  looksLikePendingAssemblySchema,
} from "@/lib/grants/application";

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
});

// Initialization seeds from a catalog entry matched by EXPLICIT key only —
// never inferred from the opportunity's title or agency. Omitting catalogKey
// initializes an empty custom scaffold (sections are then added by hand), so
// a funder outside the catalog works anywhere.
const initApplicationSchema = z
  .object({
    catalogKey: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .nullable();

const reorderSchema = z
  .object({
    sectionOrder: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict();

type RouteContext = {
  params: Promise<{ opportunityId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.application.init", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid funding opportunity id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = initApplicationSchema.safeParse(payloadBody.data ?? null);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json({ error: "Invalid application init payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadFundingOpportunityAccess(
      supabase,
      parsedParams.data.opportunityId,
      user.id,
      "programs.write"
    );

    if (access.error) {
      audit.error("funding_opportunity_access_failed", {
        opportunityId: parsedParams.data.opportunityId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
    }

    if (!access.opportunity) {
      return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const opportunity = access.opportunity;

    const catalogKey = parsedBody.data?.catalogKey;
    const catalogEntry = catalogKey ? findGrantProgramCatalogEntry(catalogKey) : null;
    if (catalogKey && !catalogEntry) {
      return NextResponse.json(
        {
          error: `Unknown catalog key "${catalogKey}". Application templates seed only from an explicit catalog match — initialize without a catalogKey for a custom scaffold.`,
        },
        { status: 422 }
      );
    }

    const { data: existingSections, error: existingError } = await supabase
      .from("funding_opportunity_application_sections")
      .select("id")
      .eq("opportunity_id", opportunity.id)
      .limit(1);

    if (existingError) {
      if (looksLikePendingAssemblySchema(existingError.message)) {
        return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
      }
      audit.error("application_existing_lookup_failed", {
        opportunityId: opportunity.id,
        userId: user.id,
        message: existingError.message,
      });
      return NextResponse.json({ error: "Failed to check application state" }, { status: 500 });
    }

    if ((existingSections ?? []).length > 0) {
      return NextResponse.json(
        { error: "An application is already initialized for this opportunity" },
        { status: 409 }
      );
    }

    const sectionSeeds = catalogEntry ? buildCatalogSectionSeeds(catalogEntry) : [];
    const attachmentSeeds = catalogEntry ? buildCatalogAttachmentSeeds(catalogEntry) : [];

    let sections: unknown[] = [];
    if (sectionSeeds.length > 0) {
      const { data, error } = await supabase
        .from("funding_opportunity_application_sections")
        .insert(
          sectionSeeds.map((seed) => ({
            workspace_id: opportunity.workspace_id,
            opportunity_id: opportunity.id,
            status: "not_started",
            updated_by: user.id,
            ...seed,
          }))
        )
        .select(APPLICATION_SECTION_SELECT);

      if (error) {
        if (looksLikePendingAssemblySchema(error.message)) {
          return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
        }
        audit.error("application_sections_seed_failed", {
          opportunityId: opportunity.id,
          userId: user.id,
          message: error.message,
        });
        return NextResponse.json({ error: "Failed to seed application sections" }, { status: 500 });
      }
      sections = data ?? [];
    }

    let attachments: unknown[] = [];
    if (attachmentSeeds.length > 0) {
      const { data, error } = await supabase
        .from("funding_opportunity_attachments")
        .insert(
          attachmentSeeds.map((seed) => ({
            workspace_id: opportunity.workspace_id,
            opportunity_id: opportunity.id,
            status: "missing",
            updated_by: user.id,
            ...seed,
          }))
        )
        .select(APPLICATION_ATTACHMENT_SELECT);

      if (error) {
        if (looksLikePendingAssemblySchema(error.message)) {
          return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
        }
        audit.error("application_attachments_seed_failed", {
          opportunityId: opportunity.id,
          userId: user.id,
          message: error.message,
        });
        return NextResponse.json({ error: "Failed to seed application attachments" }, { status: 500 });
      }
      attachments = data ?? [];
    }

    audit.info("application_initialized", {
      opportunityId: opportunity.id,
      workspaceId: opportunity.workspace_id,
      userId: user.id,
      catalogKey: catalogEntry?.key ?? null,
      sectionCount: sections.length,
      attachmentCount: attachments.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ sections, attachments }, { status: 201 });
  } catch (error) {
    audit.error("application_init_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while initializing application" }, { status: 500 });
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.application.get", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid funding opportunity id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadFundingOpportunityAccess(
      supabase,
      parsedParams.data.opportunityId,
      user.id,
      "programs.read"
    );

    if (access.error) {
      audit.error("funding_opportunity_access_failed", {
        opportunityId: parsedParams.data.opportunityId,
        userId: user.id,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
    }

    if (!access.opportunity) {
      return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const opportunity = access.opportunity;

    const [sectionsResult, attachmentsResult] = await Promise.all([
      supabase
        .from("funding_opportunity_application_sections")
        .select(APPLICATION_SECTION_SELECT)
        .eq("opportunity_id", opportunity.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("funding_opportunity_attachments")
        .select(APPLICATION_ATTACHMENT_SELECT)
        .eq("opportunity_id", opportunity.id)
        .order("sort_order", { ascending: true }),
    ]);

    // Read-side pending-schema tolerance: an un-migrated deployment gets an
    // explicit disclosure, never an empty state presented as "no application".
    const pendingMessage = [sectionsResult.error?.message, attachmentsResult.error?.message].find(
      (message) => looksLikePendingAssemblySchema(message)
    );
    if (pendingMessage) {
      return NextResponse.json(
        { sections: [], attachments: [], schemaPending: true, error: APPLICATION_PENDING_SCHEMA_ERROR },
        { status: 200 }
      );
    }

    if (sectionsResult.error || attachmentsResult.error) {
      audit.error("application_load_failed", {
        opportunityId: opportunity.id,
        userId: user.id,
        message: sectionsResult.error?.message ?? attachmentsResult.error?.message,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Failed to load application" }, { status: 500 });
    }

    return NextResponse.json({
      sections: sectionsResult.data ?? [],
      attachments: attachmentsResult.data ?? [],
      schemaPending: false,
    });
  } catch (error) {
    audit.error("application_get_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while loading application" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.application.reorder", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid funding opportunity id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = reorderSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid reorder payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadFundingOpportunityAccess(
      supabase,
      parsedParams.data.opportunityId,
      user.id,
      "programs.write"
    );

    if (access.error) {
      return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
    }
    if (!access.opportunity) {
      return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
    }
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const opportunity = access.opportunity;

    const { data: existing, error: existingError } = await supabase
      .from("funding_opportunity_application_sections")
      .select("id")
      .eq("opportunity_id", opportunity.id);

    if (existingError) {
      if (looksLikePendingAssemblySchema(existingError.message)) {
        return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
      }
      return NextResponse.json({ error: "Failed to load application sections" }, { status: 500 });
    }

    const existingIds = new Set(((existing ?? []) as Array<{ id: string }>).map((row) => row.id));
    const requestedIds = parsed.data.sectionOrder;
    const requestedSet = new Set(requestedIds);

    // The order must name every section of THIS opportunity exactly once —
    // a partial or cross-opportunity order would silently scramble sort keys.
    if (
      requestedSet.size !== requestedIds.length ||
      requestedIds.length !== existingIds.size ||
      requestedIds.some((id) => !existingIds.has(id))
    ) {
      return NextResponse.json(
        { error: "sectionOrder must list every section of this opportunity exactly once" },
        { status: 422 }
      );
    }

    const updatedAt = new Date().toISOString();
    for (const [index, sectionId] of requestedIds.entries()) {
      const { error: updateError } = await supabase
        .from("funding_opportunity_application_sections")
        .update({ sort_order: index, updated_by: user.id, updated_at: updatedAt })
        .eq("id", sectionId)
        .eq("opportunity_id", opportunity.id);

      if (updateError) {
        audit.error("application_reorder_failed", {
          opportunityId: opportunity.id,
          sectionId,
          userId: user.id,
          message: updateError.message,
        });
        return NextResponse.json({ error: "Failed to reorder application sections" }, { status: 500 });
      }
    }

    const { data: sections, error: reloadError } = await supabase
      .from("funding_opportunity_application_sections")
      .select(APPLICATION_SECTION_SELECT)
      .eq("opportunity_id", opportunity.id)
      .order("sort_order", { ascending: true });

    if (reloadError) {
      return NextResponse.json({ error: "Failed to reload application sections" }, { status: 500 });
    }

    audit.info("application_reordered", {
      opportunityId: opportunity.id,
      userId: user.id,
      sectionCount: requestedIds.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ sections: sections ?? [] });
  } catch (error) {
    audit.error("application_reorder_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while reordering application" }, { status: 500 });
  }
}

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { creationScope } from "./fixtures/land-use-plans/creation";
import { readCreationRecords } from "@/lib/land-use-plans/create-recovery";
import { getPlanKindDescriptor } from "@/lib/land-use-plans/registry";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";

const mocks = vi.hoisted(() => ({ create: vi.fn(), membership: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: () => <div data-testid="study-area-picker" /> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("@/lib/workspaces/current", () => ({ loadCurrentWorkspaceMembership: mocks.membership }));
import LandUsePlansPage from "@/app/(app)/land-use-plans/page";

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  mocks.create.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: creationScope.actorId } }, error: null }) }, from: mocks.from });
  mocks.from.mockImplementation((table: string) => { if (table !== "land_use_plans") throw new Error("Office location must not select plan authority"); return { select: mocks.select }; });
  mocks.select.mockReturnValue({ eq: mocks.eq }); mocks.eq.mockReturnValue({ order: mocks.order }); mocks.order.mockResolvedValue({ data: [], error: null });
  mocks.membership.mockResolvedValue({ membership: { workspace_id: creationScope.workspaceId, role: "member" }, workspace: { name: "SYNTHETIC office" } });
});
describe("plan-owned first-run rule selection", () => {
  it("passes each family-kind hash from the real page into the saved creation draft", async () => {
    render(await LandUsePlansPage());
    fireEvent.change(await screen.findByLabelText("Plan title"), { target: { value: "SYNTHETIC kind selection" } });
    const savedHash = () => {
      const saved = readCreationRecords(localStorage, creationScope).find(record => record.value?.kind === "draft")?.value;
      expect(saved?.kind).toBe("draft");
      if (saved?.kind !== "draft") throw Error("Page did not supply a usable selection");
      return saved.fields.descriptorHash;
    };
    expect(savedHash()).toBe(hashFrozenRecord(getPlanKindDescriptor("local-unconfigured", "comprehensive")));
    fireEvent.change(screen.getByLabelText("Legal checklist"), { target: { value: "us-ca-general-plan" } });
    expect(savedHash()).toBe(hashFrozenRecord(getPlanKindDescriptor("us-ca-general-plan", "comprehensive")));
    fireEvent.change(screen.getByLabelText("Plan kind"), { target: { value: "area" } });
    const draft = readCreationRecords(localStorage, creationScope).find(record => record.value?.kind === "draft")?.value;
    expect(draft?.kind).toBe("draft");
    if (draft?.kind !== "draft") throw Error("Page did not supply a usable selection");
    expect(draft.fields.descriptorHash).toBe(hashFrozenRecord(getPlanKindDescriptor("us-ca-general-plan", "area")));
    expect(draft.fields.descriptorHash).not.toBe(hashFrozenRecord(getPlanKindDescriptor("us-ca-general-plan", "comprehensive")));
  });
  it.each(["CA", "PR", null])("starts neutral and offers plan-assessed rules with office subdivision %s", async home => {
    mocks.membership.mockResolvedValue({ membership: { workspace_id: creationScope.workspaceId, role: "member" }, workspace: { home_country_code: "US", home_subdivision_code: home } });
    render(await LandUsePlansPage());
    expect(await screen.findByLabelText("Legal checklist")).toHaveValue("local-unconfigured");
    expect(screen.getByRole("option", { name: "California" })).toBeVisible();
    expect(screen.getByText(/Your office location does not select its law/)).toBeVisible();
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("land_use_plans");
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining("land_use_plan_versions!land_use_plan_versions_plan_id_workspace_id_fkey"));
    expect(mocks.eq).toHaveBeenCalledWith("workspace_id", creationScope.workspaceId);
  });
  it("preserves an unreadable plan list without a false empty-state claim", async () => {
    mocks.order.mockResolvedValue({ data: null, error: { message: "list unavailable" } }); render(await LandUsePlansPage());
    expect(await screen.findByLabelText("Legal checklist")).toHaveValue("local-unconfigured");
    expect(screen.getByText(/could not read land use plans/i)).toBeVisible(); expect(screen.queryByText(/No land use plans yet/)).toBeNull();
  });
  it("keeps read-only members from creating or retrying plans", async () => {
    mocks.membership.mockResolvedValue({ membership: { workspace_id: creationScope.workspaceId, role: "viewer" } }); render(await LandUsePlansPage());
    expect(await screen.findByLabelText("Legal checklist")).toBeDisabled(); expect(screen.getByRole("button", { name: "Create plan and first working version" })).toBeDisabled();
  });
});

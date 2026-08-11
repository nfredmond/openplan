import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceIntegrationKeysPanel } from "@/components/workspaces/workspace-integration-keys-panel";

/**
 * The guided-setup panel for per-workspace integration keys. Everything it
 * renders comes from the API payload (which reads the registry in
 * src/lib/integrations/providers.ts) — these tests feed it fixture payloads
 * and assert the honesty rules:
 *
 *   - a 422 (probe refused, key NOT saved) shows the server's refusal verbatim
 *     and never a success state;
 *   - a non-configurable provider (build-time browser token) gets no input,
 *     only env instructions and a live check of the deployment's key;
 *   - a deployment that cannot encrypt gets operator instructions, not a save
 *     button that would fail.
 */

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

type ProviderFixture = Record<string, unknown>;

function provider(overrides: ProviderFixture): ProviderFixture {
  return {
    workspaceConfigurable: true,
    envKeyPresent: false,
    storedKey: null,
    ...overrides,
  };
}

const AI_PROVIDER = provider({
  id: "anthropic",
  label: "Anthropic (Claude)",
  purpose: "AI drafting and engagement synthesis.",
  keySignupUrl: "https://example.test/ai-keys",
  envVar: "ANTHROPIC_API_KEY",
  envKeyPresent: true,
});

const DATA_PROVIDER = provider({
  id: "census",
  label: "US Census Bureau",
  purpose: "County search and demographics.",
  keySignupUrl: "https://example.test/data-keys",
  envVar: "CENSUS_API_KEY",
});

const MAP_PROVIDER = provider({
  id: "mapbox",
  label: "Mapbox",
  purpose: "Basemaps and map rendering.",
  keySignupUrl: "https://example.test/map-tokens",
  envVar: "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN",
  workspaceConfigurable: false,
  workspaceConfigurableNote:
    "The browser map token is compiled into the app at build time, so a per-workspace token cannot take effect at runtime yet.",
  envKeyPresent: true,
});

function payload(overrides?: {
  providers?: ProviderFixture[];
  storageAvailable?: boolean;
}): Record<string, unknown> {
  return {
    providers: overrides?.providers ?? [AI_PROVIDER, DATA_PROVIDER, MAP_PROVIDER],
    storageAvailable: overrides?.storageAvailable ?? true,
  };
}

/** Keyed by method — the only POST target is the validate endpoint. */
function mockFetch(responses: Record<string, { ok?: boolean; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    const response = responses[method] ?? { body: {} };
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function providerRow(label: RegExp): HTMLElement {
  const heading = screen.getByRole("heading", { name: label });
  const row = heading.closest("li");
  if (!row) throw new Error(`No row element around heading ${label}`);
  return row;
}

describe("WorkspaceIntegrationKeysPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders only the requested provider rows when a providerIds filter is given", async () => {
    // The dashboard hoists the Anthropic row into the first-run checklist's
    // AI step with providerIds={["anthropic"]}, and renders the remaining
    // providers in the main panel — this filter is what keeps each provider
    // row mounted exactly once across the two.
    mockFetch({ GET: { body: payload() } });

    render(
      <WorkspaceIntegrationKeysPanel
        workspaceId={WORKSPACE_ID}
        canManage
        providerIds={["anthropic"]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Anthropic \(Claude\)/ })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: /US Census Bureau/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Mapbox/ })).not.toBeInTheDocument();
    // The configured count describes what is on screen, not the whole payload.
    expect(screen.getByText("1 of 1 configured")).toBeInTheDocument();
  });

  it("renders one row per provider from the GET payload, with status and signup link", async () => {
    const { calls } = mockFetch({ GET: { body: payload() } });

    render(<WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Anthropic \(Claude\)/ })).toBeInTheDocument(),
    );
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toContain("/api/workspaces/integration-keys");
    expect(calls[0]!.url).toContain(WORKSPACE_ID);

    // Env-backed provider names the env var it is running on.
    const aiRow = providerRow(/Anthropic/);
    expect(within(aiRow).getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();

    // Unconfigured provider says so and states the consequence.
    const dataRow = providerRow(/US Census Bureau/);
    expect(within(dataRow).getByText(/Not configured/)).toBeInTheDocument();
    expect(within(dataRow).getByText(/unavailable or degraded/)).toBeInTheDocument();

    // Every row links to where a team gets its own key, in a new tab.
    const links = screen.getAllByRole("link", { name: /where to get a key/i });
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.test/ai-keys",
      "https://example.test/data-keys",
      "https://example.test/map-tokens",
    ]);
    for (const link of links) expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows the stored-key masked status and the AI spend disclosure", async () => {
    mockFetch({
      GET: {
        body: payload({
          providers: [
            provider({
              ...AI_PROVIDER,
              storedKey: { keyLast4: "9xyz", updatedAt: "2026-07-24T00:00:00.000Z", decryptable: true },
            }),
            DATA_PROVIDER,
          ],
        }),
      },
    });

    render(<WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage />);

    expect(await screen.findByText(/Workspace key ••••9xyz/)).toBeInTheDocument();
    // Your-key-your-spend: only the row with a stored AI key carries the note,
    // and it discloses that PUBLIC portal visitors consume the key too — not
    // just the workspace's team.
    expect(
      screen.getByText(
        /AI usage from this workspace — including its public engagement portal — bills this workspace's own Anthropic account/,
      ),
    ).toBeInTheDocument();
  });

  it("warns instead of claiming an active key when the stored key no longer decrypts", async () => {
    mockFetch({
      GET: {
        body: payload({
          providers: [
            provider({
              ...AI_PROVIDER,
              storedKey: { keyLast4: "9xyz", updatedAt: "2026-07-24T00:00:00.000Z", decryptable: false },
            }),
            provider({
              ...DATA_PROVIDER,
              storedKey: { keyLast4: "7abc", updatedAt: "2026-07-24T00:00:00.000Z", decryptable: false },
            }),
          ],
        }),
      },
    });

    render(<WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage />);
    await screen.findByRole("heading", { name: /Anthropic/ });

    // The amber warning replaces the active-key status: the secret changed,
    // so the row is NOT an active workspace key.
    const aiRow = providerRow(/Anthropic/);
    expect(
      within(aiRow).getByText(/Stored workspace key ••••9xyz can no longer be read/),
    ).toBeInTheDocument();
    expect(within(aiRow).getByText("OPENPLAN_INTEGRATION_KEY_SECRET")).toBeInTheDocument();
    // With an env key present, it says requests fall back to it and asks for re-entry.
    expect(within(aiRow).getByText(/Requests are using this deployment's/)).toBeInTheDocument();
    expect(within(aiRow).getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
    expect(within(aiRow).getByText(/Re-enter the workspace key/)).toBeInTheDocument();
    // Neither the active-key status nor the billing claim renders — the
    // workspace key is not what requests are running on.
    expect(within(aiRow).queryByText(/^Workspace key ••••9xyz/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bills this workspace's own Anthropic account/)).not.toBeInTheDocument();
    // Remove stays available so the dead row can be cleared.
    expect(within(aiRow).getByRole("button", { name: /^remove$/i })).toBeInTheDocument();

    // Without an env fallback, the warning states the honest consequence.
    const dataRow = providerRow(/US Census Bureau/);
    expect(
      within(dataRow).getByText(/Stored workspace key ••••7abc can no longer be read/),
    ).toBeInTheDocument();
    expect(within(dataRow).getByText(/unavailable or degraded until the key is re-entered/)).toBeInTheDocument();
  });

  it("renders nothing at all for a member", async () => {
    const { fetchMock } = mockFetch({ GET: { body: payload() } });

    const { container } = render(
      <WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage={false} />,
    );

    expect(container.firstChild).toBeNull();
    // It does not even ask the server — key management is owner/admin work.
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("PUTs a pasted key and shows the server's success detail and new masked status", async () => {
    const { calls } = mockFetch({
      GET: { body: payload() },
      PUT: {
        body: {
          storedKey: { keyLast4: "1234", updatedAt: "2026-07-27T00:00:00.000Z" },
          detail: "Key verified and saved — ••••1234",
        },
      },
    });

    render(<WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage />);
    await screen.findByRole("heading", { name: /US Census Bureau/ });

    const dataRow = providerRow(/US Census Bureau/);
    fireEvent.change(within(dataRow).getByLabelText(/workspace key/i), {
      target: { value: "sk-test-key-1234" },
    });
    fireEvent.click(within(dataRow).getByRole("button", { name: /validate & save/i }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toBe("/api/workspaces/integration-keys");
    expect(put.body).toEqual({
      workspaceId: WORKSPACE_ID,
      provider: "census",
      key: "sk-test-key-1234",
    });

    // The server's own detail line, verbatim, plus the updated status.
    expect(await screen.findByText("Key verified and saved — ••••1234")).toBeInTheDocument();
    expect(within(providerRow(/US Census Bureau/)).getByText(/Workspace key ••••1234/)).toBeInTheDocument();
  });

  it("shows a 422 probe refusal verbatim and no success state — the key was not saved", async () => {
    mockFetch({
      GET: { body: payload() },
      PUT: {
        ok: false,
        status: 422,
        body: { error: "That key was refused by the provider (401), so it was not saved." },
      },
    });

    render(<WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage />);
    await screen.findByRole("heading", { name: /US Census Bureau/ });

    const dataRow = providerRow(/US Census Bureau/);
    fireEvent.change(within(dataRow).getByLabelText(/workspace key/i), {
      target: { value: "not-a-real-key" },
    });
    fireEvent.click(within(dataRow).getByRole("button", { name: /validate & save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That key was refused by the provider (401), so it was not saved.",
    );
    expect(screen.queryByText(/verified and saved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Workspace key ••••/)).not.toBeInTheDocument();
    // The row still shows its honest unconfigured status.
    expect(within(providerRow(/US Census Bureau/)).getByText(/Not configured/)).toBeInTheDocument();
  });

  it("removes a stored key after a confirm that names the env fallback", async () => {
    const confirmMock = vi.fn((_message?: string) => true);
    vi.stubGlobal("confirm", confirmMock);
    const { calls } = mockFetch({
      GET: {
        body: payload({
          providers: [
            provider({
              ...AI_PROVIDER,
              storedKey: { keyLast4: "9xyz", updatedAt: "2026-07-24T00:00:00.000Z" },
            }),
          ],
        }),
      },
      DELETE: { body: {} },
    });

    render(<WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage />);
    await screen.findByText(/Workspace key ••••9xyz/);

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    // The confirm text says what removal falls back to.
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(String(confirmMock.mock.calls[0]![0])).toMatch(/fall back to this deployment's ANTHROPIC_API_KEY/);

    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    const del = calls.find((call) => call.method === "DELETE")!;
    expect(del.url).toBe("/api/workspaces/integration-keys");
    expect(del.body).toEqual({ workspaceId: WORKSPACE_ID, provider: "anthropic" });

    // Status falls back to the env var, and the removal notice repeats the fallback.
    expect(await screen.findByText(/Workspace key removed/)).toBeInTheDocument();
    expect(screen.queryByText(/Workspace key ••••9xyz/)).not.toBeInTheDocument();
  });

  it("gives a non-configurable provider no input — only the note and a deployment-key check", async () => {
    const { calls } = mockFetch({
      GET: { body: payload() },
      POST: {
        body: { ok: true, detail: "The token was accepted.", source: "env" },
      },
    });

    render(<WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage />);
    await screen.findByRole("heading", { name: /Mapbox/ });

    const mapRow = providerRow(/Mapbox/);
    expect(within(mapRow).queryByLabelText(/workspace key/i)).not.toBeInTheDocument();
    expect(within(mapRow).queryByRole("button", { name: /validate & save/i })).not.toBeInTheDocument();
    expect(within(mapRow).getByText(/compiled into the app at build time/)).toBeInTheDocument();
    // Named twice, both honestly: the status line (the deployment key in use)
    // and the operator instructions.
    expect(within(mapRow).getAllByText("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN").length).toBeGreaterThan(0);

    fireEvent.click(within(mapRow).getByRole("button", { name: /validate deployment key/i }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe("/api/workspaces/integration-keys/validate");
    // No key field: the check targets whatever the deployment already uses.
    expect(post.body).toEqual({ workspaceId: WORKSPACE_ID, provider: "mapbox" });

    // Result carries the server detail AND labels which key answered.
    expect(
      await within(providerRow(/Mapbox/)).findByText(/The token was accepted\. \(deployment env key\)/),
    ).toBeInTheDocument();
  });

  it("withholds every paste input when the deployment cannot store keys, and says why", async () => {
    mockFetch({ GET: { body: payload({ storageAvailable: false }) } });

    render(<WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage />);
    await screen.findByRole("heading", { name: /Anthropic/ });

    expect(screen.queryByLabelText(/workspace key/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /validate & save/i })).not.toBeInTheDocument();
    // Operator instructions, one per configurable provider, naming the secret.
    expect(screen.getAllByText("OPENPLAN_INTEGRATION_KEY_SECRET")).toHaveLength(2);
    expect(
      screen.getAllByText(/Per-workspace keys are unavailable on this deployment/).length,
    ).toBe(2);
    // Env instructions remain: each row still names its deployment env var.
    expect(screen.getByText("CENSUS_API_KEY")).toBeInTheDocument();
  });

  it("surfaces a load failure instead of an empty panel", async () => {
    mockFetch({ GET: { ok: false, status: 500, body: { error: "Integration keys are unavailable right now" } } });

    render(<WorkspaceIntegrationKeysPanel workspaceId={WORKSPACE_ID} canManage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Integration keys are unavailable right now",
    );
  });
});

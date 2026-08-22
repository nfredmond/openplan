import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
}));

import { AerialEvidencePackageCreator } from "@/components/aerial/aerial-evidence-package-creator";

/**
 * Logging what a flight produced. Same shape as the mission creator beside it:
 * entered rather than open on the project page, no navigation, and the
 * confirmation lives on the panel because the flow closes on success.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

const MISSIONS = [
  { id: "m-1", title: "SR 49 corridor lidar" },
  { id: "m-2", title: "Bridge deck inspection" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function open() {
  render(<AerialEvidencePackageCreator missionOptions={MISSIONS} />);
  fireEvent.click(screen.getByTestId("evidence-package-creator-open"));
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

describe("logging an evidence package", () => {
  it("is behind a button, not open on the project page", () => {
    render(<AerialEvidencePackageCreator missionOptions={MISSIONS} />);
    expect(screen.getByTestId("evidence-package-creator-open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Package name")).toBeNull();
  });

  it("defaults to the first mission rather than to nothing", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Package name"), { target: { value: "Ortho" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Log the package" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.missionId).toBe("m-1");
  });

  it("honours an explicit default mission over the first in the list", async () => {
    render(<AerialEvidencePackageCreator missionOptions={MISSIONS} defaultMissionId="m-2" />);
    fireEvent.click(screen.getByTestId("evidence-package-creator-open"));
    fireEvent.change(screen.getByLabelText("Package name"), { target: { value: "Deck ortho" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Log the package" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    // A default that lost to the first option would silently file the package
    // against the wrong flight.
    expect(body.missionId).toBe("m-2");
  });

  it("posts the same keys, with blank notes absent", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Mission"), { target: { value: "m-2" } });
    fireEvent.change(screen.getByLabelText("Package name"), { target: { value: "QA bundle" } });
    fireEvent.change(screen.getByLabelText("What kind of package?"), {
      target: { value: "qa_bundle" },
    });
    next();
    fireEvent.change(screen.getByLabelText("How ready is it to be verified?"), {
      target: { value: "partial" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log the package" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/aerial/evidence-packages");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      missionId: "m-2",
      title: "QA bundle",
      packageType: "qa_bundle",
      status: "processing",
      verificationReadiness: "partial",
    });
    expect("notes" in body).toBe(false);
  });

  it("stays on the project page and confirms on the panel", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Package name"), { target: { value: "Ortho" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Log the package" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("evidence-package-logged")).toHaveTextContent(
      "Evidence package logged."
    );
  });

  it("clears the confirmation when the next package is started", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Package name"), { target: { value: "Ortho" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Log the package" }));
    expect(await screen.findByTestId("evidence-package-logged")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("evidence-package-creator-open"));
    expect(screen.queryByTestId("evidence-package-logged")).toBeNull();
  });

  it("will not log a package with no name", () => {
    open();
    next();

    expect(
      screen.getAllByText(/Give the package a name before you log it/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

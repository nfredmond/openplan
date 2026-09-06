import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportArtifactPreview } from "@/app/(app)/reports/[reportId]/_components/report-artifact-preview";

afterEach(() => vi.restoreAllMocks());

// jsdom does not render srcDoc. Populate its document only as the browser would,
// then exercise the actual onLoad binding and a real cross-document click event.
function preview(
  href: string,
  attrs: Record<string, string> = {},
  dispatchLoad = true,
) {
  const html = `<p>Frozen report content</p>`;
  render(<ReportArtifactPreview html={html} />);
  const frame = screen.getByTitle(
    "Latest report artifact preview",
  ) as HTMLIFrameElement;
  expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
  expect(frame).toHaveAttribute("srcdoc", html);
  const link = frame.contentDocument!.createElement("a");
  link.setAttribute("href", href);
  for (const [name, value] of Object.entries(attrs))
    link.setAttribute(name, value);
  const text = frame.contentDocument!.createElement("span");
  text.textContent = "Open the project record";
  link.append(text);
  frame.contentDocument!.body.append(link);
  if (dispatchLoad) fireEvent.load(frame);
  const navigations: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.ownerDocument).toBe(document);
    expect(this.isConnected).toBe(true);
    navigations.push(this);
  });
  return { frame, text, navigations };
}

describe("native navigation out of the scriptless report preview", () => {
  it("binds a preview that already loaded before hydration", () => {
    const { text, navigations } = preview("/projects/project-id", {}, false);
    fireEvent.click(text);
    expect(navigations).toHaveLength(1);
    expect(navigations[0].pathname).toBe("/projects/project-id");
  });

  it("opens the exact project URL in the host, not the iframe", () => {
    const { text, navigations } = preview(
      "/projects/project-id?tab=overview#project-identity",
    );
    expect(fireEvent.click(text)).toBe(false);
    expect(navigations).toHaveLength(1);
    expect(navigations[0].href).toBe(
      `${window.location.origin}/projects/project-id?tab=overview#project-identity`,
    );
    expect(navigations[0].target).toBe("_self");
    expect(navigations[0].isConnected).toBe(false);
  });

  it("keeps source links separate and prevents opener access", () => {
    const { text, navigations } = preview("https://source.example/evidence");
    fireEvent.click(text);
    expect(navigations[0].href).toBe("https://source.example/evidence");
    expect(navigations[0].target).toBe("_blank");
    expect(navigations[0].rel).toBe("noopener noreferrer");
  });

  it("preserves native attachment downloads", () => {
    const { text, navigations } = preview(
      "/api/reports/report/artifacts/artifact/download",
      { download: "evidence.pdf" },
    );
    fireEvent.click(text);
    expect(navigations[0].pathname).toBe(
      "/api/reports/report/artifacts/artifact/download",
    );
    expect(navigations[0].download).toBe("evidence.pdf");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,script",
    "blob:https://source.example/id",
    "",
    "https://[",
  ])("refuses unsafe or invalid navigation: %s", (href) => {
    const { text, navigations } = preview(href);
    expect(fireEvent.click(text)).toBe(false);
    expect(navigations).toHaveLength(0);
  });

  it("keeps local section anchors inside the report", () => {
    const { text, navigations } = preview("#appendix");
    expect(fireEvent.click(text)).toBe(true);
    expect(navigations).toHaveLength(0);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])(
    "supports modified clicks: %j",
    (options) => {
      const { text, navigations } = preview("/projects/project-id");
      fireEvent.click(text, options);
      expect(navigations[0].target).toBe("_blank");
      expect(navigations[0].rel).toBe("noopener noreferrer");
    },
  );

  it("supports middle clicks and explicit new tabs", () => {
    const { text, navigations } = preview("/projects/project-id", {
      target: "_blank",
    });
    fireEvent.click(text);
    fireEvent(
      text,
      new MouseEvent("auxclick", {
        button: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(navigations.map((link) => link.target)).toEqual([
      "_blank",
      "_blank",
    ]);
  });

  it("does not duplicate navigation after the same document loads twice", () => {
    const { frame, text, navigations } = preview("/projects/project-id");
    fireEvent.load(frame);
    fireEvent.click(text);
    expect(navigations).toHaveLength(1);
  });
});

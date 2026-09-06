"use client";

import { useEffect, useRef } from "react";

// Follow a user-selected report link through a native anchor in the host page.
// The report stays scriptless; neither frozen HTML nor sandbox grants change.
function followPreviewLink(event: MouseEvent) {
  if (event.defaultPrevented || event.button > 1) return;
  const element = event.target as Element | null;
  const link = element?.closest?.("a[href]");
  if (!link) return;
  const href = link.getAttribute("href")?.trim();
  if (href?.startsWith("#")) return; // Keep section jumps inside this document.
  event.preventDefault();
  if (!href) return;

  let destination: URL;
  try {
    destination = new URL(href, window.location.href);
  } catch {
    return;
  }
  if (!["http:", "https:"].includes(destination.protocol)) return;

  const navigation = document.createElement("a");
  navigation.href = destination.href;
  navigation.target =
    destination.origin !== window.location.origin ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.button === 1 ||
    link.getAttribute("target") === "_blank"
      ? "_blank"
      : "_self";
  navigation.rel = "noopener noreferrer";
  if (link.hasAttribute("download"))
    navigation.download = link.getAttribute("download") ?? "";
  document.body.append(navigation);
  navigation.click();
  navigation.remove();
}

function bindPreviewLinks(frame: HTMLIFrameElement | null) {
  const content = frame?.contentDocument;
  if (!content) return;
  // Replacement also avoids duplicate handlers when a preview reloads.
  content.onclick = followPreviewLink;
  content.onauxclick = followPreviewLink;
}

export function ReportArtifactPreview({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  // A server-rendered preview can finish loading before React attaches onLoad.
  useEffect(() => {
    bindPreviewLinks(frame.current);
  }, [html]);
  return (
    <iframe
      ref={frame}
      title="Latest report artifact preview"
      className="h-[900px] w-full"
      // Same-origin permits authenticated frozen images and parent-owned link
      // handling. Scripts, forms, popups and frame-driven top navigation stay off.
      sandbox="allow-same-origin"
      srcDoc={html}
      onLoad={(event) => bindPreviewLinks(event.currentTarget)}
    />
  );
}

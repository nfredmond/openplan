/** Explicit synthetic component-layout fixture; never writes a campaign or calls a model. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { EngagementSynthesisPanel } from "../../../openplan/src/components/engagement/engagement-synthesis-panel";
import { historical } from "../../../openplan/src/test/fixtures/engagement/legacy-synthesis";
const requireApp = createRequire(resolve(process.cwd(), "package.json"));
const React = requireApp("react");
const { renderToStaticMarkup } = requireApp("react-dom/server");
Object.assign(globalThis, { React });
const markup = renderToStaticMarkup(React.createElement(EngagementSynthesisPanel, {
  initialSynthesis: historical, initialSynthesizedAt: "2026-09-01T12:00:00Z",
}));
writeFileSync('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/legacy-panel-fixture.html', markup);

# Model readiness integration, October 18, 2026

This checkpoint joins the independently reviewed study-disclosure change
`c282f0b4` and launcher change `7eff35a5`. Both reviews find no concrete
source defects. Frozen scientific artifacts and numerical requirements stay
unchanged. The added requirement is the version-parser dependency.

The combined source passes 74 focused app tests, 16 launcher tests, four
dependency-pin checks, shell syntax and the direction check. Fifteen existing
download/inventory cases are not rerun. Author and independent negative controls
remain recorded in the two source notes. A real preflight accepts the pinned
environment and refuses pandas 3.0.3 before worker entry.

Browser acceptance remains pending. The identified local build `b1fc7984396b`
shows the disclosures through normal navigation and reports no horizontal
overflow at 390 pixels. Preview PNGs duplicate the viewport. Separate Chrome
attempts retain navigation timeouts; the explicitly bounded replacement server
then reaches its 2 GiB cgroup limit. These are not passing captures. Deployed
packaging and download operation also remain unverified.

Separately, one actual development baseline on unchanged worker source
`dfe86e70a` completes network setup, then fails assignment with
`Compact routing source chain differs from endpoints`. Extraction skips and
zero artifacts publish. The failure stays preserved; its graph diagnosis is
separate from these launcher and disclosure corrections. No model accuracy,
scientific acceptance, Stage A closure or release claim follows.

Raw browser, resource and model evidence stays private.

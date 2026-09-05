# Nat Ford Planning website refresh: adoption task

September 4, 2026. Nathaniel explicitly requests a future website update presenting OpenPlan as his main product, with quick, beautiful routes to understanding it, obtaining it and installing it. This is a companion adoption deliverable for the review roadmap. No website redesign or publication was performed or is claimed by this checkpoint.

## Located source and bounded review

The repository is [nfredmond/nat-ford-website](https://github.com/nfredmond/nat-ford-website), main `08348b08dff1b657d978d75467ba233f42287517`, last reported push July 21, 2026. GitHub lists `https://nfpa-website.vercel.app` as its homepage. Confirm the actual canonical domain and serving revision before implementation; a repository homepage value does not prove the current production target.

Inventoried the repository tree, then read CLAUDE.md and package.json and sampled the homepage, OpenPlan page and header at that exact SHA through the GitHub API. Current source already includes an OpenPlan navigation item, a substantial flagship section, an `/openplan` page, source links and optional deployment/support language. Preserve these foundations and brand assets. The homepage still presents several open-source projects and its prominent actions include consultation/exploration. The OpenPlan page emphasizes discussion/source and conditionally shows a demo link; no direct installation link was found in the sampled home/OpenPlan/header source. This is a bounded source finding, not proof that installation guidance is absent everywhere.

The web tool returned an older cached site emphasizing general planning/GIS services, conflicting with the sampled GitHub source. No actual browser or current serving-commit check occurred, so that cached page is not accepted as current visual evidence. Website CLAUDE.md also says no test runner is wired, while package.json contains an npm test chain of nine named checks. Reconcile instructions against actual commands before implementation; no test was run here. No secrets, lead/contact records, Stripe actions, Supabase operations or website checkout edits were accessed/performed.

## Intended visitor journey

1. Understand OpenPlan as Nat Ford Planning's main product, who it serves and a few concrete planning jobs it helps complete. Distinguish current working capabilities from the full v1 destination.
2. Get the same free software through an obvious GitHub/release link and concise installation entry. Explain prerequisites and optional provider costs in plain language; link to canonical OpenPlan installation documentation instead of maintaining a conflicting copy.
3. Open a working demonstration or request an invitation when M15 has established that access. Before then, label availability accurately and provide current, source-identified examples. A missing hosted trial must not produce a dead or misleading Try now action.
4. Find optional implementation, annual administration and customization, with an ordinary contact path. Clearly distinguish those services from software licensing and independent self-hosting. A free user can find releases, documentation, issue requests and contribution instructions without becoming a sales lead.

## Implementation and completion criteria

W1 belongs in the existing website repository. Reuse its design system, typography, logo assets and useful product content; do not start another marketing app. Give the homepage one clear product hierarchy, a short useful product demonstration, Get OpenPlan/installation actions and concise service explanations. Keep Nathaniel's planning qualifications and other work accessible as supporting context. Favor responsive, accessible layouts and optimized real product imagery over expensive decorative animation. Do not promise unverified modeling accuracy or imply simulated screenshots are actual output.

The website and OpenPlan documentation must agree on release status, installation requirements, license, optional hosting/services and readiness. Verify the installation destination against a clean-machine recipe. Separate ready-to-ship website work from trial links dependent on M15; the product explanation and install path can improve before hosted trials exist. Check the site's own deployment and commercial-provider eligibility before publishing, without assuming its current Vercel account plan.

Done means a new agency/consultant visitor can identify the product, find how to install/use it independently and understand optional services without a guided tour. Verify actual links, form routing through controlled test handling, keyboard/focus, contrast, reduced motion, desktop and 390px layouts, and inspect current screenshots and console. Measure loading and image/script weight on a constrained connection; compare before/after rather than claiming fast from a build. Check canonical URLs, metadata/social previews, redirects and privacy statements. Preserve old useful links and accurate prior-employment attribution.

This is a future implementation task, not an OpenPlan feature gate or a requirement to buy a service. Before editing the website, check its local instructions, active sessions and repository state; before publishing, complete a concrete reviewable preview and the required checks. No money or deployment change is authorized by this todo-list addition.

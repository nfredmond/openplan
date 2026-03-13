# OpenPlan App Shell Migration Note

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — first structural shell migration pass

## What changed
Implemented the first Planning OS shell correction pass in the live OpenPlan app.

### Structural routing/layout changes
- Root layout simplified to neutral wrapper only.
- Added dedicated route-group layouts:
  - `src/app/(public)/layout.tsx`
  - `src/app/(auth)/layout.tsx`
  - `src/app/(app)/layout.tsx`
- Moved pages into explicit surfaces:
  - public home now under `(public)`
  - authenticated/app-shell routes now under `(app)`
  - auth flows under `(auth)`

### New desktop/web shell
- Added persistent left-rail app shell via `src/components/app-shell.tsx`
- Added primary app navigation with Planning OS module framing
- Added contextual secondary nav via `src/components/nav/app-secondary-nav.tsx`
- Added active-state sidebar links via `src/components/nav/app-sidebar-link.tsx`
- Reframed top bar as utility chrome instead of primary site navigation

### New module placeholders added
- `/projects`
- `/plans`
- `/programs`
- `/engagement`
- `/scenarios`
- `/models`
- `/data-hub`
- `/reports`
- `/admin`

### Product language correction
- Public home page no longer frames OpenPlan as corridor-only
- Pricing page now describes pilot scope more honestly: platform foundation + live Analysis Studio module
- Public top nav updated to align with Planning OS positioning

## Intent of this pass
This pass does **not** claim the full Planning OS is implemented.
It establishes the correct application shell and information architecture so subsequent work can land inside the right product frame.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`24` files, `129` tests)
- `npm run build` ✅

## Immediate next recommended step
Bind the new shell to actual first-class domain objects and begin replacing placeholder modules with real Planning OS entities, starting with:
1. Projects
2. Plans
3. Programs
4. Engagement
5. Scenario / model surfaces

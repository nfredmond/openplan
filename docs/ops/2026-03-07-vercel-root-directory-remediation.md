# OpenPlan Vercel Root Directory Remediation — 2026-03-07

## Objective
Resolve repeated production deployment failures in `natford/openplan` caused by Vercel building from the repository root instead of the Next.js app directory.

## Symptom (pre-fix)
Recent production deploys were failing in 6–9s with:
- `Warning: Could not identify Next.js version...`
- `Error: No Next.js version detected... check your Root Directory setting...`

Observed from failed deployment:
- `openplan-5hz9k6sx2-natford.vercel.app`

## Root Cause
Project setting `rootDirectory` was unset (`null`, shown as `.` in `vercel project inspect`), so Vercel built from repo root where there is no app `package.json` containing Next.js.

## Remediation Executed
1. Verified project settings:
   - `npx -y vercel project inspect openplan --scope natford`
   - Confirmed `Root Directory: .`
2. Verified failing deployment logs:
   - `npx -y vercel inspect openplan-5hz9k6sx2-natford.vercel.app --scope natford --logs`
3. Patched project root directory via Vercel API:
   - `PATCH /v9/projects/openplan` body: `{ "rootDirectory": "openplan" }`
4. Re-ran production deployment by redeploying the latest failed artifact:
   - `npx -y vercel redeploy openplan-5hz9k6sx2-natford.vercel.app --scope natford`

## Verification Evidence
- New production deployment: `openplan-qabavszol-natford.vercel.app`
- Status: `Ready`
- Production alias updated: `https://openplan-zeta.vercel.app`
- Additional aliases present:
  - `https://openplan-natford.vercel.app`
  - `https://openplan-git-master-natford.vercel.app`

## Residual Risk / Follow-Up
- Historical failed deployments remain in history (expected).
- Next validation step: confirm subsequent Git-triggered production deploys also build successfully under `rootDirectory: openplan`.

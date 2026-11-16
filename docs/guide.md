# Usage and development

[README](../README.md) / [Reader](../reader/README.md) / [Sync](../sync/README.md)

## Windows setup

Install Reader using the [installation instructions](../reader/README.md#installation), then run from the repository root:

```powershell
npm run open
```

Use a dedicated Chrome profile, never your everyday profile. Save work in the dedicated profile before running the launcher or tests, which may close it. See [`exam-practice.example.toml`](../exam-practice.example.toml) for path overrides.

For iPhone setup, see [opening the next question](../sync/README.md#open-the-next-question).

## Tests

Run the complete suite before pushing or deploying repository changes. Targeted tests do not replace this requirement. Run from the repository root on Windows using the project's npm lock and ignored local installation.

```powershell
npm ci
npm ls --all
npm run build
```

Provision Chrome from an elevated PowerShell 7 session. This changes machine-wide Chrome policies for all profiles, including permission to use DevTools and CDP. Do not overwrite conflicting policies.

```powershell
npm run test:chrome-policy
mise exec -- pwsh -NoProfile -File C:/dev/settings/browser-policies/scripts/provision-tampermonkey.ps1 -Operation Install -WhatIf
mise exec -- pwsh -NoProfile -File C:/dev/settings/browser-policies/scripts/provision-tampermonkey.ps1 -Operation Install
mise exec -- pwsh -NoProfile -File C:/dev/settings/browser-policies/scripts/provision-tampermonkey.ps1 -Operation Verify
```

Copy [`exam-practice.example.toml`](../exam-practice.example.toml) to `exam-practice.toml` and set `EXAM_PRACTICE_SYNC_TOKEN` to the production Worker token. Keep secrets out of source control. Let the live tests manage userscript installation and browser restarts; do not edit browser storage or Secure Preferences manually.

```powershell
npm test
```

`npm test` covers local contracts, both site integrations, system Chrome, iPhone control emulation, and the real question sites. After deployment, `npm run test:production` verifies the real Chrome/Tampermonkey launch, sync, dashboard and copy-failure reporting. It writes production learning records and the OS clipboard. Both gates are mandatory; Reader release runs both. Do not skip prerequisites or substitute mocks for production checks. See [`package.json`](../package.json) and the test sources for coverage.

### iOS Safari

On a Mac configured for the [CI environment](../.github/workflows/ios-safari.yml):

```bash
npm run test:ios-safari
```

This simulator suite does not replace real-device Tampermonkey, speech, or production-sync verification.

## Release and deployment

For changes spanning components, complete these steps in order:

1. Pass the [complete tests](#tests).
2. Integrate with jj and push only `main` to origin.
3. [Deploy Sync](../sync/README.md#deployment), then pass the complete `test:production` gate.
4. If changed, deploy the independent [congratulations package](https://github.com/expgolemclone/congratulations#development-and-testing) and verify production.
5. [Release Reader](../reader/README.md#release), including production-sync live tests and GitHub publication.

For a single-component change, follow that component's linked procedure. A push alone does not complete a change to production artifacts.

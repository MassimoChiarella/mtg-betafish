# MTG Betafish

## Development milestones and release checks

The active roadmap and verification ledger are in [docs/development-plan.md](docs/development-plan.md).

Run `npm ci`, then `npx playwright install chromium` once. `npm run check:release` runs lint, types, the production build, deterministic Node tests, gzip bundle budgets, and desktop/mobile Chromium gameplay tests against the static export. GitHub Actions runs the same release gate on every push and pull request and preserves browser measurement attachments plus any failure traces. Windows sandboxed runners need permission to terminate their own browser/server child processes.

Saved sessions use a separately versioned scenario catalog. **Save / restore** exports or imports validated JSON, recovers the previous valid autosave, and downloads preserved incompatible data. It is also available from game over. Files are limited to 1 MiB; importing never accepts a file's storage revision. A failed backup prevents replacement of the primary save.

A browser companion for stress-testing Magic: The Gathering Commander decks while playing them in a separate playtester such as Archidekt. MTG Betafish supplies the missing table: targeted interaction, wipes, counters, round-scaled combat, defensive rolls, and countdown threats.

## Run locally

Requires Node.js 24.x (also pinned in `.nvmrc`).

```bash
npm ci
npm run dev
```

Open the printed local URL, keep your deck playtester beside it, and resolve each generated event before advancing the round.

## What it tracks

- one to three opponent deck profiles with visible, bracket-specific core-card packages
- per-opponent Commander brackets that scale pacing, interaction, and threat clocks
- optional first-strike and regular combat-damage steps with editable life, poison, commander-damage, and lifelink results, including zero-filled steps that were not generated
- event-specific legal response choices, repeatable counter exchanges, and scenario-specific empty outcomes
- user and opponent life, poison counters, and commander damage per stable primary or Partner commander identity
- ongoing can’t-lose effects plus an exact totals editor that can correct life, poison, each commander ledger, and post-reload eliminations
- outgoing attackers assigned across multiple defenders, separate responses, and one atomic combat result/undo
- one active threat countdown that becomes a playable, answerable win attempt when it expires
- developing, established and rebuilding opponent boards that affect subsequent pressure
- optional seat-by-seat rounds and source/recipient-aware reminders at actual upkeep or turn deadlines
- true round-1/event-1 seeded runs, transactional undo, retained-history review, and a validated version-7 local draft with legacy migration and explicit cross-tab conflict choices
- named device-local matchup presets with validated import/export; loading a preset changes only a new-run draft

The app intentionally does not reproduce the battlefield or replace a Magic rules engine. Users resolve exact targets, blocks, prevention, replacement effects, and card interactions in their playtester, then record the result here. Outgoing combat records all selected defenders together; reopen the form only for another combat. Commander damage remains attached to the displayed original commander identity when control changes outside the app. Seat cadence represents actions across a round, not literal Magic turns or a priority engine; due effects are confirmed at their stated timing in the playtester.

## Scenario catalog

The versioned catalog, bracket-specific deck cores, Commander bracket heuristics, and event templates live in `app/simulator.ts`. Update `CARD_LIBRARY`, `DECK_PROFILES`, templates, and the displayed catalog date together when refreshing emblematic cards or archetypes. All 90 profile/bracket core slots can surface as conditional spell, ability or land-play encounters. The user confirms prerequisites, costs and exact effects; sightings are possible, not guaranteed draws from hidden decklists. Keyword explanations follow Wizards’ official glossary.

Bracket names and pacing guidance reflect the versioned Wizards Commander Brackets model represented by this release. The app’s exact counter, removal, combat, and defense probabilities are simulation heuristics rather than official rules. Profiles are abstract matchup presets, not full color-identity-validated 100-card decklists.

## Checks

`npm run check:performance` measures the existing production export and a warmed 40-entry session. It fails on gzip size regressions, not machine-dependent timing. The browser suite also attaches a mobile 4× CPU-slowdown interaction report. See [docs/performance.md](docs/performance.md) for measurement scope, results and interpretation.

```bash
npm run check
```

This runs lint, generates route types, checks TypeScript, builds the static export, and runs all Node tests. `npm run build` also checks exported HTML, direct scripts, module-preloaded hydration chunks, styles, images, metadata, monitoring configuration, and security headers, so a successful bundler run cannot silently deploy an empty site.

For an interactive smoke check, `tests/browser-smoke.mjs` exports `runBrowserSmoke(tab, url)` for an existing Codex Browser runtime tab. After connecting through the Browser skill, import this helper from the checkout and call it with a disposable Vercel Preview URL (or an ordinary local static preview). When serving a Vercel-built export locally, pass `{ vercelBuild: true }` as the third argument. It verifies hydration, a life change persisting after reload, table setup, the scenario library, monitoring-script counts, and console errors. It restores its life increment and never reads or clears browser storage. Do not use an active player's session. This is an operator-run browser check, separate from `npm run check`; it needs no additional browser-driver dependency.

## Deploy to Vercel

Import this repository into Vercel. The committed `vercel.json` sets the framework to **Other**, installs with `npm ci`, runs `npm run check`, and publishes only `dist/client`. Node.js is pinned to **24.x** in `package.json`.

The application is a static Vinext export: there are no server functions, database bindings, or API keys to configure. Content-hashed assets under `/_next/static/` receive immutable browser caching; HTML and unversioned assets revalidate. The existing Sites manifest also points to the same static output.

Vercel responses disable MIME sniffing, set an explicit referrer policy, and allow framing only by the same origin. The CSP restricts only `frame-ancestors`, preserving Vinext's inline hydration, monitoring scripts, and external card images. Cross-origin embedding would require deliberately updating that policy and `X-Frame-Options` together.

Canonical links and social previews use the build-time `SITE_URL` when provided, otherwise Vercel's production domain (`VERCEL_PROJECT_PRODUCTION_URL`), then its deployment URL (`VERCEL_URL`). Vercel system environment variables must be exposed to builds (the default). For a custom domain, optionally set `SITE_URL=https://your-domain.example` and redeploy after changing it. Local builds fall back to `http://localhost:3000`; no incoming request headers affect metadata.

Vercel Web Analytics records page views and basic Speed Insights records performance metrics on Vercel builds only; ordinary local and other-host builds do not load them. Enable Web Analytics in the Vercel dashboard before deploying. The root layout passes Vercel's public `VERCEL_OBSERVABILITY_CLIENT_CONFIG` to both React integrations at build time so their hosted endpoints work with the static Vinext export. No custom gameplay events or saved session data are sent. Performance telemetry includes page URLs and browser/device information; keep sensitive information out of URLs.

Speed Insights uses the free tier, with no Plus upgrade or paid overage configured. As of September 2026, the free allocation is 10,000 events over the last 30 days shared across the team; exceeding it pauses collection for 14 days, not the website. Start with default sampling for this low-traffic site and reduce `sampleRate` if usage approaches the cap. Free reports are limited; consult Vercel's current limits before changing plans. Verify data after a normal page visit and navigation away, since performance metrics can flush on blur/unload.

Push a branch other than `main` to create an isolated Vercel Preview deployment. After verifying it, merge into `main` to deploy to production. Analytics defaults to production data; select the Preview environment in its dashboard to inspect preview visits.

To check exactly the static files that will be deployed:

```bash
npm run build
npm start
```

Open the printed preview URL. Confirm the app reaches **Saved locally**, change a life total, reload and confirm it persists, then open table setup and the scenario library. This preview serves static files only, without a server-rendering fallback. Saved sessions are browser/domain-local; there is no domain-migration step.

## Dependency maintenance

Dependabot checks npm dependencies weekly and limits version-update proposals to three open pull requests. Related React packages and Vinext/Vite build tools are grouped for minor/patch updates; major upgrades remain separate. No automatic merging is configured. Review release notes, run all checks, and test the Preview before merging, including for beta or patch releases. Security-update proposals use GitHub's separate security-update settings and are not restricted by the version-update PR limit.

## Configuration and secrets

MTG Betafish needs no API keys. `SITE_URL` is optional public configuration, shown in `.env.example`; use `.env.local` for local overrides. Scryfall card images use its public API without authentication.

If configuration is added later, keep local values in `.env.local` or `.dev.vars`; these files, project-level npm credentials, and common private-key formats are ignored. Commit only placeholder values in `.env.example`, and store production secrets in the hosting platform's secret manager.

Magic: The Gathering and Commander are trademarks of Wizards of the Coast. MTG Betafish is an unofficial companion and is not affiliated with Wizards of the Coast or Archidekt.

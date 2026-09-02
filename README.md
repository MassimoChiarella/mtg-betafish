# MTG Betafish

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
- outgoing attackers and randomized block, removal, fog, or no-response outcomes
- one active game-ending threat with a round countdown and visible owner context
- true round-1/event-1 seeded runs, transactional undo, history, and a validated version-6 local draft with legacy migration and explicit cross-tab conflict choices

The app intentionally does not reproduce the battlefield or replace a Magic rules engine. Users resolve exact targets, blocks, prevention, replacement effects, and card interactions in their playtester, then record the result here. Outgoing combat records one defender per submission; reopen the form for split attacks or externally created extra combats. Commander damage remains attached to the displayed original commander identity when control changes outside the app.

## Scenario catalog

The versioned catalog, bracket-specific deck cores, Commander bracket heuristics, and event templates live in `app/simulator.ts`. Update `CARD_LIBRARY`, `DECK_PROFILES`, templates, and the displayed catalog date together when refreshing emblematic cards or archetypes. Core cards can surface as deck-intel encounters without pretending the opponent cast them. Keyword explanations follow Wizards’ official glossary.

Bracket names and pacing guidance reflect the versioned Wizards Commander Brackets model represented by this release. The app’s exact counter, removal, combat, and defense probabilities are simulation heuristics rather than official rules. Profiles are abstract matchup presets, not full color-identity-validated 100-card decklists.

## Checks

```bash
npm run check
```

This runs lint, generates route types, checks TypeScript, builds the static export, and runs all tests. `npm run build` also checks that exported HTML, scripts, styles, images, and metadata exist, so a successful bundler run cannot silently deploy an empty site.

## Deploy to Vercel

Import this repository into Vercel. The committed `vercel.json` sets the framework to **Other**, installs with `npm ci`, runs `npm run check`, and publishes only `dist/client`. Node.js is pinned to **24.x** in `package.json`.

The application is a static Vinext export: there are no server functions, database bindings, or API keys to configure. Content-hashed assets under `/_next/static/` receive immutable browser caching; HTML and unversioned assets revalidate. The existing Sites manifest also points to the same static output.

Canonical links and social previews use the build-time `SITE_URL` when provided, otherwise Vercel's production domain (`VERCEL_PROJECT_PRODUCTION_URL`), then its deployment URL (`VERCEL_URL`). Vercel system environment variables must be exposed to builds (the default). For a custom domain, optionally set `SITE_URL=https://your-domain.example` and redeploy after changing it. Local builds fall back to `http://localhost:3000`; no incoming request headers affect metadata.

Vercel Web Analytics records page views on Vercel deployments only; local development and other hosts do not load it. Enable Web Analytics in the Vercel dashboard before deploying. The root layout passes Vercel's public `VERCEL_OBSERVABILITY_CLIENT_CONFIG` to the React integration at build time so its hosted endpoints work with the static Vinext export. No custom gameplay events or saved session data are sent.

Push a branch other than `main` to create an isolated Vercel Preview deployment. After verifying it, merge into `main` to deploy to production. Analytics defaults to production data; select the Preview environment in its dashboard to inspect preview visits.

To check exactly the static files that will be deployed:

```bash
npm run build
npm start
```

Open the printed preview URL. Confirm the app reaches **Saved locally**, change a life total, reload and confirm it persists, then open table setup and the scenario library. This preview serves static files only, without a server-rendering fallback. Saved sessions are browser/domain-local; there is no domain-migration step.

## Configuration and secrets

MTG Betafish needs no API keys. `SITE_URL` is optional public configuration, shown in `.env.example`; use `.env.local` for local overrides. Scryfall card images use its public API without authentication.

If configuration is added later, keep local values in `.env.local` or `.dev.vars`; these files, project-level npm credentials, and common private-key formats are ignored. Commit only placeholder values in `.env.example`, and store production secrets in the hosting platform's secret manager.

Magic: The Gathering and Commander are trademarks of Wizards of the Coast. MTG Betafish is an unofficial companion and is not affiliated with Wizards of the Coast or Archidekt.

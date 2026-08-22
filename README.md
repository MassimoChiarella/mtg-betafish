# MTG Betafish

A browser companion for stress-testing Magic: The Gathering Commander decks while playing them in a separate playtester such as Archidekt. MTG Betafish supplies the missing table: targeted interaction, wipes, counters, turn-scaled combat, defensive rolls, and countdown threats.

## Run locally

Requires Node.js 22.18 or newer.

```bash
npm ci
npm run dev
```

Open the printed local URL, keep your deck playtester beside it, and resolve each generated event before advancing the turn.

## What it tracks

- one to three opponent deck profiles with visible included-card packages
- per-opponent Commander brackets that scale pacing, interaction, and threat clocks
- rules-aware incoming attacks with combat keywords
- responses, counter-to-counter exchanges, and no-legal-target outcomes
- user and opponent life totals plus commander damage per commander source
- outgoing attackers and randomized block, removal, fog, or no-response outcomes
- one active game-ending threat with a turn countdown
- seeded event sequences, undo, history, and a same-device session draft

The app intentionally does not reproduce the battlefield or replace a Magic rules engine. Users resolve exact targets, blocks, and card interactions in their playtester, then record the result here.

## Scenario catalog

The versioned catalog, deck profiles, Commander bracket heuristics, and event templates live in `app/simulator.ts`. Update `CARD_LIBRARY`, `DECK_PROFILES`, templates, and the displayed catalog date together when refreshing emblematic cards or archetypes. Keyword explanations follow Wizards’ official glossary.

Bracket names and turn guidance follow Wizards’ current beta system. The app’s exact counter, removal, combat, and defense probabilities are simulation heuristics rather than official rules. Profiles are abstract matchup presets, not full color-identity-validated 100-card decklists.

## Checks

```bash
npm run build
npm run lint
npm test
```

## Configuration and secrets

MTG Betafish currently needs no API keys or local environment variables. Scryfall card data and images use its public API without authentication.

If configuration is added later, keep local values in `.env.local` or `.dev.vars`; these files, project-level npm credentials, and common private-key formats are ignored. Commit only placeholder values in `.env.example`, and store production secrets in the hosting platform's secret manager.

Magic: The Gathering and Commander are trademarks of Wizards of the Coast. MTG Betafish is an unofficial companion and is not affiliated with Wizards of the Coast or Archidekt.

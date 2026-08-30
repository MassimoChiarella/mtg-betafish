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

- one to three opponent deck profiles with visible, bracket-specific core-card packages
- per-opponent Commander brackets that scale pacing, interaction, and threat clocks
- ordered first-strike and regular combat-damage steps with editable life, poison, commander-damage, and lifelink results
- event-specific legal response choices, repeatable counter exchanges, and scenario-specific empty outcomes
- user and opponent life, poison counters, and commander damage per stable primary or Partner commander identity
- outgoing attackers and randomized block, removal, fog, or no-response outcomes
- one active game-ending threat with a turn countdown
- seeded event sequences, transactional undo, history, and a validated same-device version-5 session draft with legacy migration

The app intentionally does not reproduce the battlefield or replace a Magic rules engine. Users resolve exact targets, blocks, prevention, replacement effects, and card interactions in their playtester, then record the result here. Outgoing combat records one defender per submission; reopen the form for split attacks or externally created extra combats. Commander damage remains attached to the displayed original commander identity when control changes outside the app.

## Scenario catalog

The versioned catalog, bracket-specific deck cores, Commander bracket heuristics, and event templates live in `app/simulator.ts`. Update `CARD_LIBRARY`, `DECK_PROFILES`, templates, and the displayed catalog date together when refreshing emblematic cards or archetypes. Core cards can surface as deck-intel encounters without pretending the opponent cast them. Keyword explanations follow Wizards’ official glossary.

Bracket names and turn guidance reflect the versioned Wizards Commander Brackets model represented by this release. The app’s exact counter, removal, combat, and defense probabilities are simulation heuristics rather than official rules. Profiles are abstract matchup presets, not full color-identity-validated 100-card decklists.

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

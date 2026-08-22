# Goldfish Lab

A browser companion for stress-testing Magic: The Gathering Commander decks while playing them in a separate playtester such as Archidekt. Goldfish Lab supplies the missing table: targeted interaction, wipes, counters, turn-scaled combat, defensive rolls, and countdown threats.

## Run locally

Requires Node.js 22.18 or newer.

```bash
npm install
npm run dev
```

Open the printed local URL, keep your deck playtester beside it, and resolve each generated event before advancing the turn.

## What it tracks

- one to three opponent profiles with distinct pressure and defense patterns
- rules-aware incoming attacks with combat keywords
- responses, counter-to-counter exchanges, and no-legal-target outcomes
- user and opponent life totals plus commander damage per commander source
- outgoing attackers and randomized block, removal, fog, or no-response outcomes
- one active game-ending threat with a turn countdown
- seeded event sequences, undo, history, and a same-device session draft

The app intentionally does not reproduce the battlefield or replace a Magic rules engine. Users resolve exact targets, blocks, and card interactions in their playtester, then record the result here.

## Scenario catalog

The versioned catalog and generic event templates live in `app/simulator.ts`. Update `CARD_LIBRARY`, templates, and the displayed catalog date together when refreshing emblematic cards or archetypes. Keyword explanations follow Wizards’ official glossary.

## Checks

```bash
npm run build
npm test
```

Magic: The Gathering and Commander are trademarks of Wizards of the Coast. Goldfish Lab is an unofficial companion and is not affiliated with Wizards of the Coast or Archidekt.

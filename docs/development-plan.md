# Practice improvements — development timeline

This plan implements the agreed application assessment in independently tested, incremental GitHub milestones. The simulator remains a practice companion, not a full Magic rules engine: the user confirms board-dependent outcomes in their playtester.

## Milestones

- [x] **1. Spell outcome accounting and resilient card previews**
  - Centralize resolved / countered / illegal-target outcomes and tracked life changes.
  - Confirm target controller and Swords to Plowshares power; distinguish indestructible protection from illegal targets.
  - Preserve additional-cost handling and multiplayer elimination.
  - Add image retry and an accessible card-reference link.
- [x] **2. Durable, catalog-aware sessions**
  - Separate catalog metadata from structural save validation and migrate older sessions.
  - Preserve a recoverable prior save; never silently destroy invalid imports.
  - Add validated session export, import, and backup recovery.
- [x] **3. Browser regression and release gates**
  - Automate gameplay, responses, combat, undo, reload, elimination and cross-tab conflicts.
  - Cover mobile preview recovery and keyboard operation.
  - Run deterministic engine checks and browser tests in GitHub Actions.
- [x] **4. Playable win attempts**
  - Convert expiring clocks into answerable encounters rather than automatic losses.
  - Give Oracle, Reservoir, and Craterhoof distinct completion checks.
  - Preserve loss protection, owner elimination, undo and reload behavior.
- [x] **5. Opponent development and archetype identity**
  - Track developing, established and rebuilding states.
  - Make confirmed engine removal and board wipes reduce subsequent pressure.
  - Add bracket-specific core-card encounters without passive signature reveals or forced use.
- [ ] **6. Round scheduling and due effects**
  - Keep quick rounds and add optional seat-by-seat play.
  - Track source/recipient and timing for Arcane Denial and goad reminders.
  - Handle skipped eliminated seats, expiry, reload and undo.
- [ ] **7. Multi-defender outgoing combat**
  - Enter attackers once and assign each to a living defender.
  - Roll and inspect defenses separately; confirm damage per defender and damage step.
  - Apply one atomic result with correct lifelink, poison, commander damage and elimination.
- [ ] **8. Matchup presets and session review**
  - Save/load/delete named device-local matchup configurations.
  - Show retained history and an end-run review of answers and the ending cause.
  - Keep presets separate from live session state and validate imports.
- [ ] **9. Measured performance and final verification**
  - Record bundle sizes and repeatable mobile-throttled interaction measurements.
  - Optimize only demonstrated work (including repeated save normalization if measured).
  - Add regression budgets and document field vs lab limitations.
  - Run the complete release gate, update documentation, and push the final tested milestone.

## Release discipline

Each implementation milestone updates this file with its verification evidence and is committed and pushed separately. Existing saves and cross-tab conflict protection remain release requirements. Rules-sensitive changes receive deterministic tests; browser tests cover actual user workflows. GitHub/Vercel remains the requested publication path.

## Verification ledger

- **Plan baseline:** clean `main` at `06c35d4`; prior assessment passed build, lint, typecheck and 208 tests. No measured browser latency claim is carried forward from bundle sizes alone.
- **Milestone 1:** targeted spells now confirm resolution status and target controller, including Swords power and legal indestructible targets; preview failures offer Retry and a Scryfall reference. Production build, lint, typecheck and all 212 Node tests pass. Browser workflow coverage follows in milestone 3.
- **Milestone 2:** schema 7 separates catalog revision from structural checks. v6 protected totals and paid costs survive migration. Writes preserve a prior valid save or quarantine incompatible raw data before replacement. Export/import/recovery are size-bounded and validated, including from game over. Build, typecheck, lint and the full Node suite pass; migration, quota-failure, quarantine and portable-file tests added.
- **Milestone 3:** 14 real Chromium desktop/mobile journeys pass against the static production export. Tests cover imported scenarios, Swords accounting, illegal targets, locked Toxic costs, counterback reload, lethal combat/undo, cross-tab choices and failed-image retry. GitHub Actions now runs the full release gate on pushes/PRs. Browser child-process cleanup was verified outside the restrictive Windows process sandbox.
- **Milestone 4:** expiring clocks become answerable Oracle, Reservoir or Craterhoof encounters. Reservoir locks a payable 50-life cost, checks source departure and records actual damage; Oracle requires explicit win-condition confirmation; Craterhoof uses editable combat. Unknown legacy clocks get a manual-condition encounter. Build, lint, typecheck, full Node suite and 20 desktop/mobile browser journeys pass. Ordinary Commander win effects are distinct from tracked numeric losses (CR 104.2b; limited range of influence is not modeled).
- **Milestone 5:** all 90 profile/bracket core slots are reachable as conditional spell, ability or land-play encounters, with detailed scripts for 30 representative cards and Oracle-preview-guided resolution for the remaining cards. Reservoir reuses its enforced-cost workflow. Exact prerequisites, costs and effects are confirmed in the external playtester, not invented as a full hidden deck. Persistent rebuilding reduces combat odds/power and pauses new clocks; successful development restores pressure. Wipe/engine setbacks are explicitly selected per board. Full Node suite, build, lint, typecheck and 24 browser journeys pass; every core slot has reachability/save-validation coverage. GitHub Actions for milestone 4 also passed.

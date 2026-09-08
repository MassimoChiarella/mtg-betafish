import assert from "node:assert/strict";
import test from "node:test";
import { CORE_ENCOUNTERS, DECK_PROFILES, coreEncounter, eventKindWeights, generateEvent, nextDevelopment } from "../app/simulator.ts";
import { coreOutcome } from "../app/opponent-development.ts";
import { decodeGameState } from "../app/session.ts";
import { fixture } from "./browser/fixtures.mjs";

test("every bracket-specific core card is a reachable, serializable actual encounter", () => {
  assert.equal(CORE_ENCOUNTERS.length, 90);
  for (const [profile, deck] of Object.entries(DECK_PROFILES)) for (const [bracket, cards] of Object.entries(deck.coreCards)) {
    const seen = new Set();
    const game = fixture(); game.opponents = [{ ...game.opponents[0], profile, bracket: Number(bracket), development: "established" }];
    for (let counter = 1; counter <= 400; counter++) {
      const event = generateEvent({ turn: 8, counter, seed: "CORE-COVERAGE", opponents: game.opponents, recentTemplateIds: [], activeThreat: false });
      if (coreEncounter(event.templateId) || event.templateId === "reservoir-attempt") {
        seen.add(event.card);
        assert.ok(decodeGameState({ ...game, turn: 8, eventCounter: counter, currentEvent: event }));
      }
    }
    for (const card of cards) assert.ok(seen.has(card), `${profile} B${bracket}: ${card}`);
  }
});

test("rebuilding reduces attack pressure and pauses new clocks, then recovers in steps", () => {
  const input = { turn: 10, profile: "swarm", bracket: 4, activeThreat: false };
  const established = eventKindWeights({ ...input, development: "established" });
  const rebuilding = eventKindWeights({ ...input, development: "rebuilding" });
  assert.ok(rebuilding.attack < established.attack);
  assert.equal(rebuilding.threat, 0);
  assert.ok(rebuilding.development > established.development);
  assert.equal(nextDevelopment("rebuilding"), "developing");
  assert.equal(nextDevelopment("developing"), "established");
});

test("resolved core effects record explicit state; answered and absent actions do not invent development", () => {
  const game = fixture(); const core = CORE_ENCOUNTERS[0];
  game.currentEvent = { ...game.currentEvent, ...core, templateId: core.id };
  game.opponents[0].development = "rebuilding";
  assert.equal(coreOutcome(game, "resolved", 41, 40, "established").opponents[0].development, "established");
  assert.equal(coreOutcome(game, "answered", 39, 40, "established").opponents[0].development, "rebuilding");
  assert.deepEqual(coreOutcome(game, "not-viable", 41, 30, "established"), {});
  assert.throws(() => coreOutcome(game, "resolved", 1.5, 40, "established"));
});

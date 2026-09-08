import assert from "node:assert/strict";
import test from "node:test";
import { spellOutcome } from "../app/spell-outcome.ts";

const state = (templateId) => ({ currentEvent: { templateId, card: templateId, sourceId: "one", sourceName: "One" }, userLife: 40, opponents: [{ id: "one", name: "One", life: 40, poisonCounters: 0, commanderDamage: {}, eliminated: false, lossProtected: false }], activeThreat: null, gameOver: null });
test("resolved Claim and Swords credit the actual controller, not always the user", () => {
  assert.equal(spellOutcome(state("early-rock"), "resolved", "user").patch.userLife, 44);
  const redirected = spellOutcome(state("exile-commander"), "resolved", "one", 7);
  assert.equal(redirected.patch.userLife, 40);
  assert.equal(redirected.patch.opponents[0].life, 47);
  assert.equal(spellOutcome(state("exile-commander"), "resolved", "user", -2).patch.userLife, 40);
});
test("countered and illegal-target spells have no resolution effects", () => {
  for (const card of ["early-rock", "exile-commander", "remove-engine", "destroy-creature"]) {
    for (const result of ["countered", "illegal"]) assert.deepEqual(spellOutcome(state(card), result, "user", 8).patch, {});
  }
});
test("resolved Unmaking can eliminate its source, cancelling their threat", () => {
  const game = state("remove-engine"); game.opponents[0].life = 3; game.activeThreat = { ownerId: "one" };
  const result = spellOutcome(game, "resolved", "user");
  assert.equal(result.patch.opponents[0].eliminated, true);
  assert.equal(result.patch.activeThreat, null);
  assert.ok(result.patch.gameOver);
  game.opponents[0].lossProtected = true;
  assert.equal(spellOutcome(game, "resolved", "user").patch.opponents[0].eliminated, false);
});
test("indestructible still permits Beast Within's token; invalid input is rejected", () => {
  assert.match(spellOutcome(state("destroy-creature"), "resolved", "one").detail, /creates a 3\/3/);
  assert.throws(() => spellOutcome(state("exile-commander"), "resolved", "user", 2.5));
  assert.throws(() => spellOutcome(state("early-rock"), "resolved", "missing"));
});

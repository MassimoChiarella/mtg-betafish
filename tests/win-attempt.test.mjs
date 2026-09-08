import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./browser/fixtures.mjs";
import { decodeGameState } from "../app/session.ts";
import { expireThreat, payReservoir, reservoirDamage } from "../app/win-attempt.ts";

function attempt(templateId) {
  const game = fixture(templateId, { responseStage: "resolved", reservoirPayment: null });
  game.activeThreat = { ...game.currentEvent.threat, remaining: 1 };
  return { ...game, ...expireThreat(game, 7) };
}

test("expiring clocks create distinct unresolved attempts, never automatic losses", () => {
  for (const [original, expected] of [["combo-clock", "oracle-attempt"], ["artifact-clock", "reservoir-attempt"], ["combat-clock", "craterhoof-attempt"]]) {
    const game = attempt(original);
    assert.equal(game.gameOver, null);
    assert.equal(game.activeThreat, null);
    assert.equal(game.currentEvent.templateId, expected);
    assert.equal(game.responseStage, "prompt");
    assert.ok(decodeGameState(game));
    assert.equal(expireThreat(game, 8), null);
  }
  const combat = attempt("combat-clock");
  assert.equal(combat.currentEvent.kind, "attack");
  assert.ok(combat.currentEvent.attackers.every((attacker) => attacker.keywords.includes("Trample")));
  assert.ok(combat.currentEvent.attackers.some((attacker) => attacker.name === "Craterhoof Behemoth"));
});

test("Reservoir payment obeys 49/50/51 life, protection and single payment", () => {
  for (const life of [49, 50, 51]) {
    const game = attempt("artifact-clock"); game.opponents[0].life = life;
    if (life === 49) { assert.throws(() => payReservoir(game)); continue; }
    const paid = { ...game, ...payReservoir(game) };
    assert.equal(paid.opponents[0].life, life - 50);
    assert.equal(paid.opponents[0].eliminated, life === 50);
    assert.equal(paid.responseStage, life === 50 ? "resolved" : "choose");
    assert.ok(decodeGameState(paid));
    assert.throws(() => payReservoir(paid));
  }
  const protectedGame = attempt("artifact-clock"); protectedGame.opponents[0].life = 50; protectedGame.opponents[0].lossProtected = true;
  const paid = { ...protectedGame, ...payReservoir(protectedGame) };
  assert.equal(paid.opponents[0].eliminated, false);
  assert.equal(paid.responseStage, "choose");
});

test("Reservoir uses actual damage and ongoing protection after reload", () => {
  const game = attempt("artifact-clock"); game.opponents[0].life = 60;
  const paid = decodeGameState({ ...game, ...payReservoir(game) });
  assert.ok(paid);
  assert.equal(reservoirDamage({ ...paid, userLife: 60 }, "user", 50).userLife, 10);
  assert.equal(reservoirDamage({ ...paid, userLife: 60 }, "user", 50).gameOver, null);
  assert.ok(reservoirDamage(paid, "user", 50).gameOver);
  assert.equal(reservoirDamage({ ...paid, userLossProtected: true }, "user", 50).gameOver, null);
  assert.equal(reservoirDamage(paid, "user", 0).userLife, 40);
  assert.equal(reservoirDamage(paid, "two", 50).opponents[1].eliminated, true);
  assert.throws(() => reservoirDamage(game, "user", 50));
});
